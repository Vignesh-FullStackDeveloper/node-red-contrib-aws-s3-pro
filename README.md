node-red-contrib-aws-s3-pro
=================

A <a href="http://nodered.org" target="_new">Node-RED</a> node for Amazon S3 operations with **production-grade connection pooling**.

**Key Features:**
- ✅ **Connection Pooling** - Shared connections across all nodes for optimal performance
- ✅ **AWS SDK v3** - Latest AWS SDK with modern architecture
- ✅ **All S3 Operations** - Support for 100+ S3 API operations
- ✅ **Automatic Connection Management** - TTL-based refresh and cleanup
- ✅ **HTTP Keep-Alive** - Reuses TCP connections for better performance

Install
-------

Run the following command in the root directory of your Node-RED install

        npm install node-red-contrib-aws-s3-pro

Usage
-----

### Configuration Node (aws-s3-config)

Configure your AWS credentials and connection settings. Supports:
- Access Key ID and Secret Access Key (from string, msg, flow, global, or env)
- IAM Role authentication (recommended for EC2/ECS/Lambda)
- Custom endpoints (for S3-compatible services)
- Region configuration

**Note:** All nodes using the same configuration share the same connection pool automatically.

### Amazon S3 Node (aws-s3) - Generic API Node

A generic node that supports **all S3 operations** using AWS SDK v3. This node provides
access to the complete S3 API including bucket management, object operations, 
multipart uploads, and advanced features.

**Features:**
- ✅ Supports all 100+ S3 operations (ListBuckets, GetObject, PutObject, DeleteObject, etc.)
- ✅ **Connection pooling** - Automatically shares connections with other nodes
- ✅ Parameters provided via message object (msg.Bucket, msg.Key, etc.)
- ✅ Automatic JSON parsing for complex objects
- ✅ Special handling for GetObject streaming (returns buffer in msg.payload)
- ✅ Dual output: success (first output) and error (second output)

**Usage Examples:**

**ListBuckets** - List all buckets:
```
No parameters needed
```

**ListObjects** - List objects in a bucket:
```javascript
msg.Bucket = "my-bucket"
// Optional: msg.Prefix = "folder/"
```

**GetObject** - Download a file:
```javascript
msg.Bucket = "my-bucket"
msg.Key = "path/to/file.txt"
// Result: msg.payload contains the file content as buffer
//         msg.s3Metadata contains file metadata
```

**PutObject** - Upload a file:
```javascript
msg.Bucket = "my-bucket"
msg.Key = "path/to/file.txt"
msg.payload = "file content" // or Buffer
// Optional: msg.ContentType = "text/plain"
```

**DeleteObject** - Delete a file:
```javascript
msg.Bucket = "my-bucket"
msg.Key = "path/to/file.txt"
```

**CopyObject** - Copy a file:
```javascript
msg.Bucket = "destination-bucket"
msg.CopySource = "source-bucket/source-key"
msg.Key = "destination-key"
```

For complex parameters, provide JSON strings in the message - they will be automatically parsed.

### Connection Pooling

**How it works:**
- All nodes using the same AWS configuration share a single connection pool
- Connections are automatically reused across multiple requests
- Connections refresh after 30 minutes (TTL) to ensure freshness
- Automatic cleanup of expired connections every 5 minutes
- HTTP keep-alive enabled for optimal TCP connection reuse

**Benefits:**
- Reduced connection overhead
- Better performance for high-frequency operations
- Lower memory usage
- Automatic connection lifecycle management

**Example:** If you have 10 `aws-s3` nodes using the same `aws-s3-config`, they all share the same connection pool automatically.