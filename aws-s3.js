/**
 * AWS S3 Node-RED Nodes
 * Production-grade implementation with connection pooling
 * Uses AWS SDK v3
 */

module.exports = function(RED) {
    "use strict";
    
    const { getPooledS3Client, shutdownPool } = require('./s3-connection-pool');
    // Import all S3 commands from AWS SDK v3
    const S3SDK = require("@aws-sdk/client-s3");

    // Register cleanup handler for Node-RED shutdown
    RED.events.on('close', () => {
        shutdownPool();
    });

    function configureS3(node, msg, getValue) {
        // Получаем параметры из конфигурации или контекста
        const awsConfig = node.awsConfig;
        const accessKeyId = getValue(awsConfig.accessKeyId, awsConfig.accessKeyIdType, msg);
        const secretAccessKey = getValue(awsConfig.secretAccessKey, awsConfig.secretAccessKeyType, msg);
        const useIamRole = awsConfig.useIamRole;
        const endpoint = getValue(awsConfig.endpoint, awsConfig.endpointType || 'str', msg);
        const forcePathStyle = awsConfig.forcepathstyle;
        const skipTlsVerify = awsConfig.skiptlsverify;
        const regionValue = getValue(awsConfig.region, awsConfig.regionType || 'str', msg) || awsConfig.region;
        if (!regionValue) {
            throw new Error('Region is missing in AWS S3 configuration');
        }
        const options = { region: regionValue };
        if (endpoint) {
            options.endpoint = endpoint;
            options.forcePathStyle = forcePathStyle || false;
            options.tls = !skipTlsVerify;
        }
        if (useIamRole) {
            if ('credentials' in options) {
                delete options.credentials;
            }
        } else {
            if (accessKeyId && secretAccessKey) {
                options.credentials = {
                    accessKeyId,
                    secretAccessKey
                };
            }
        }
        // Use connection pool instead of creating new client
        return getPooledS3Client(options);
    }

    function AWSNode(n) {
        RED.nodes.createNode(this, n);
        this.endpoint = n.endpoint;
        this.forcepathstyle = n.forcepathstyle;
        this.skiptlsverify = n.skiptlsverify;
        this.region = n.region;
        this.regionType = n.regionType;
        this.accessKeyId = n.accessKeyId;
        this.accessKeyIdType = n.accessKeyIdType;
        this.secretAccessKey = n.secretAccessKey;
        this.secretAccessKeyType = n.secretAccessKeyType;
        this.useIamRole = n.useIamRole;
        this.endpointType = n.endpointType;
    }

    RED.nodes.registerType("aws-s3-config", AWSNode, {
        credentials: {
            accesskeyid: { type: "text" },
            secretaccesskey: { type: "password" }
        }
    });

    // Amazon S3 API Node (Generic - supports all S3 operations)
    function AmazonS3APINode(n) {
        RED.nodes.createNode(this, n);
        this.awsConfig = RED.nodes.getNode(n.aws);
        this.operation = n.operation || 'ListBuckets';
        this.name = n.name || "";
        const node = this;

        /**
         * Get value from different input types
         */
        function getValue(value, type, msg) {
            if (!value) return null;
            try {
                let result;
                switch (type) {
                    case 'msg':
                        result = RED.util.getMessageProperty(msg, value);
                        break;
                    case 'flow':
                        result = node.context().flow.get(value);
                        break;
                    case 'global':
                        result = node.context().global.get(value);
                        break;
                    case 'env':
                        result = process.env[value];
                        break;
                    default:
                        result = value;
                }
                return result;
            } catch (err) {
                throw new Error(`Failed to get value for type: ${type}, value: ${value}. Error: ${err.message}`);
            }
        }

        /**
         * Build parameters for S3 operation from node config and message
         */
        function buildParams(node, msg, operation) {
            const params = {};
            
            // Copy all properties from message (excluding Node-RED internal properties)
            const excludeKeys = ['payload', 'topic', '_msgid', 'operation', 'error', 's3Response', 's3Metadata', 'bucket', 'filename', 'localFilename'];
            
            for (const key in msg) {
                // Skip internal Node-RED properties and common properties that might conflict
                if (!excludeKeys.includes(key) && msg[key] !== undefined && msg[key] !== null && msg[key] !== '') {
                    const value = msg[key];
                    
                    // Check if this is a JSON string that needs parsing
                    if (typeof value === 'string' && value.trim() !== '' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                        try {
                            params[key] = JSON.parse(value);
                        } catch (e) {
                            // If JSON parsing fails, use the string value
                            params[key] = value;
                        }
                    } else {
                        params[key] = value;
                    }
                }
            }
            
            // Handle payload specially for operations that need Body
            if (msg.payload !== undefined && !params.Body && !params.Payload) {
                // For PutObject, UploadPart and similar operations
                if (operation.includes('Put') || operation.includes('Upload')) {
                    params.Body = RED.util.ensureBuffer(msg.payload);
                }
            }
            
            return params;
        }

        node.on("input", async function(msg) {
            try {
                const s3 = configureS3(node, msg, getValue);
                const operation = node.operation || msg.operation || 'ListBuckets';
                
                // Build command class name (e.g., "ListBuckets" -> "ListBucketsCommand")
                const commandClassName = operation + 'Command';
                
                // Get the command class from SDK
                const CommandClass = S3SDK[commandClassName];
                
                // Check if command exists
                if (!CommandClass) {
                    node.error(`S3 operation "${operation}" not found. Please check the operation name.`, msg);
                    node.status({ fill: "red", shape: "ring", text: "Invalid operation" });
                    return;
                }
                
                // Build parameters
                const params = buildParams(node, msg, operation);
                
                // Create command instance
                const command = new CommandClass(params);
                
                // Update status
                node.status({ fill: "blue", shape: "dot", text: operation });
                
                // Execute command
                const data = await s3.send(command);
                
                // Handle response
                msg.payload = data;
                msg.operation = operation;
                
                // For GetObject, handle the stream
                if (operation === 'GetObject' && data.Body) {
                    const stream = data.Body;
                    let chunks = [];
                    
                    return new Promise((resolve, reject) => {
                        stream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });
                        
                        stream.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            msg.payload = buffer;
                            msg.s3Metadata = {
                                ContentType: data.ContentType,
                                ContentLength: data.ContentLength,
                                LastModified: data.LastModified,
                                ETag: data.ETag,
                                Metadata: data.Metadata
                            };
                            node.status({ fill: "green", shape: "dot", text: "success" });
                            node.send([msg, null]);
                            resolve();
                        });
                        
                        stream.on('error', (err) => {
                            node.error(`Error reading S3 object stream: ${err.message}`, msg);
                            node.status({ fill: "red", shape: "ring", text: "stream error" });
                            node.send([null, { payload: err, error: err }]);
                            reject(err);
                        });
                    });
                } else {
                    // For other operations, send the response directly
                    node.status({ fill: "green", shape: "dot", text: "success" });
                    node.send([msg, null]);
                }
                
            } catch (err) {
                node.error(`S3 API Error: ${err.message}`, msg);
                node.status({ fill: "red", shape: "ring", text: "error" });
                node.send([null, { payload: err, error: err, operation: node.operation }]);
            }
        });
    }

    RED.nodes.registerType("aws-s3", AmazonS3APINode);
};