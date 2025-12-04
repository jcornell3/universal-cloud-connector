#!/bin/bash

# Universal Cloud Connector Wrapper
# Sets up environment variables and runs the connector

# Set configuration from command line arguments or environment defaults
export server_url="${server_url:-http://localhost:3000/sse}"
export api_token="${api_token:-test-token-123}"

# Run the Node.js application
exec /home/jcornell/.nvm/versions/node/v24.11.1/bin/node /home/jcornell/universal-cloud-connector/dist/index.js
