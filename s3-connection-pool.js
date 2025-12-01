/**
 * Production-grade S3 Connection Pool Manager
 * 
 * Features:
 * - Connection pooling with configurable TTL
 * - Automatic connection refresh after expiration
 * - HTTP keepAlive for connection reuse
 * - Efficient connection cleanup
 * - Thread-safe operations
 */

"use strict";

const { S3Client } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const https = require("https");
const http = require("http");

// Default configuration
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SOCKETS = 50;
const DEFAULT_KEEP_ALIVE_MSECS = 1000;
const DEFAULT_CONNECTION_TIMEOUT = 10000;
const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * Connection pool entry
 */
class PoolEntry {
    constructor(client, httpsAgent, httpAgent) {
        this.client = client;
        this.httpsAgent = httpsAgent;
        this.httpAgent = httpAgent;
        this.createdAt = Date.now();
        this.lastUsedAt = Date.now();
        this.useCount = 0;
    }

    touch() {
        this.lastUsedAt = Date.now();
        this.useCount++;
    }

    isExpired(ttl) {
        return (Date.now() - this.createdAt) > ttl;
    }

    destroy() {
        try {
            // Destroy HTTP agents to close connections
            if (this.httpsAgent) {
                this.httpsAgent.destroy();
            }
            if (this.httpAgent) {
                this.httpAgent.destroy();
            }
        } catch (err) {
            // Ignore errors during cleanup
        }
    }
}

/**
 * S3 Connection Pool Manager
 */
class S3ConnectionPool {
    constructor(options = {}) {
        this.pool = new Map();
        this.ttl = options.ttl || DEFAULT_TTL;
        this.cleanupInterval = options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL;
        this.maxSockets = options.maxSockets || DEFAULT_MAX_SOCKETS;
        this.keepAliveMsecs = options.keepAliveMsecs || DEFAULT_KEEP_ALIVE_MSECS;
        this.connectionTimeout = options.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT;
        this.requestTimeout = options.requestTimeout || DEFAULT_REQUEST_TIMEOUT;
        
        // Start cleanup interval
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);

        // Ensure cleanup on process exit
        if (typeof process !== 'undefined') {
            process.once('SIGINT', () => this.shutdown());
            process.once('SIGTERM', () => this.shutdown());
            process.once('exit', () => this.shutdown());
        }
    }

    /**
     * Generate a stable key from configuration options
     */
    _generateKey(options) {
        // Create a normalized config object for consistent key generation
        // Note: We must include full credentials in the key to ensure different
        // credentials get separate connections, even though we don't log them
        const normalized = {
            region: options.region || 'us-east-1',
            endpoint: options.endpoint || null,
            forcePathStyle: options.forcePathStyle || false,
            tls: options.tls !== undefined ? options.tls : true,
            // Include full credentials in key to ensure proper connection separation
            credentials: options.credentials ? {
                accessKeyId: options.credentials.accessKeyId,
                secretAccessKey: options.credentials.secretAccessKey
            } : null,
            useIamRole: !options.credentials
        };
        return JSON.stringify(normalized);
    }

    /**
     * Create HTTP agents with keepAlive
     */
    _createAgents() {
        const httpsAgent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: this.keepAliveMsecs,
            maxSockets: this.maxSockets,
            maxFreeSockets: 10,
            timeout: this.connectionTimeout,
            scheduling: 'lifo' // Last in, first out for better connection reuse
        });

        const httpAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: this.keepAliveMsecs,
            maxSockets: this.maxSockets,
            maxFreeSockets: 10,
            timeout: this.connectionTimeout,
            scheduling: 'lifo'
        });

        return { httpsAgent, httpAgent };
    }

    /**
     * Create a new S3Client with optimized configuration
     */
    _createClient(options) {
        const { httpsAgent, httpAgent } = this._createAgents();

        const clientOptions = {
            ...options,
            requestHandler: new NodeHttpHandler({
                httpsAgent,
                httpAgent,
                connectionTimeout: this.connectionTimeout,
                requestTimeout: this.requestTimeout,
            }),
            maxAttempts: options.maxAttempts || 3,
        };

        const client = new S3Client(clientOptions);
        return { client, httpsAgent, httpAgent };
    }

    /**
     * Get or create a pooled S3 client
     */
    getClient(options) {
        const key = this._generateKey(options);
        let entry = this.pool.get(key);

        // Check if entry exists and is still valid
        if (entry && !entry.isExpired(this.ttl)) {
            entry.touch();
            return entry.client;
        }

        // Entry expired or doesn't exist - create new one
        if (entry) {
            // Clean up expired entry
            entry.destroy();
            this.pool.delete(key);
        }

        // Create new client
        const { client, httpsAgent, httpAgent } = this._createClient(options);
        entry = new PoolEntry(client, httpsAgent, httpAgent);
        entry.touch();
        this.pool.set(key, entry);

        return client;
    }

    /**
     * Clean up expired connections
     */
    cleanup() {
        const now = Date.now();
        const expiredKeys = [];

        for (const [key, entry] of this.pool.entries()) {
            if (entry.isExpired(this.ttl)) {
                expiredKeys.push(key);
            }
        }

        // Remove expired entries
        for (const key of expiredKeys) {
            const entry = this.pool.get(key);
            if (entry) {
                entry.destroy();
                this.pool.delete(key);
            }
        }

        if (expiredKeys.length > 0) {
            // Optional: log cleanup activity in production
            // console.log(`[S3Pool] Cleaned up ${expiredKeys.length} expired connection(s)`);
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        const stats = {
            totalConnections: this.pool.size,
            connections: []
        };

        for (const [key, entry] of this.pool.entries()) {
            stats.connections.push({
                key: key.substring(0, 100) + '...', // Truncate for safety
                age: Date.now() - entry.createdAt,
                lastUsed: Date.now() - entry.lastUsedAt,
                useCount: entry.useCount,
                isExpired: entry.isExpired(this.ttl)
            });
        }

        return stats;
    }

    /**
     * Shutdown and cleanup all connections
     */
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        for (const entry of this.pool.values()) {
            entry.destroy();
        }

        this.pool.clear();
    }

    /**
     * Clear all connections (useful for testing or forced refresh)
     */
    clear() {
        for (const entry of this.pool.values()) {
            entry.destroy();
        }
        this.pool.clear();
    }
}

// Singleton instance
let poolInstance = null;

/**
 * Get the singleton pool instance
 */
function getPool(options) {
    if (!poolInstance) {
        poolInstance = new S3ConnectionPool(options);
    }
    return poolInstance;
}

/**
 * Get a pooled S3 client
 */
function getPooledS3Client(options) {
    return getPool().getClient(options);
}

/**
 * Shutdown the pool (called on Node-RED shutdown)
 */
function shutdownPool() {
    if (poolInstance) {
        poolInstance.shutdown();
        poolInstance = null;
    }
}

module.exports = {
    getPooledS3Client,
    shutdownPool,
    getPool,
    S3ConnectionPool
};

