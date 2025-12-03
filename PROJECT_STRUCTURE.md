# Universal Cloud Connector - Project Structure

Complete guide to understanding the project layout and each file's purpose.

## Directory Tree

```
universal-cloud-connector/
│
├── 📄 manifest.json                 # MCP Bundle manifest & configuration schema
├── 📄 package.json                  # Node.js package metadata & scripts
├── 📄 package-lock.json             # Locked dependency versions
├── 📄 tsconfig.json                 # TypeScript compiler configuration
│
├── 📚 Documentation
│   ├── README.md                    # Main documentation (start here!)
│   ├── DEPLOYMENT_GUIDE.md          # Detailed setup & deployment
│   ├── QUICK_REFERENCE.md           # Quick lookup guide
│   └── PROJECT_STRUCTURE.md         # This file
│
├── 📋 License & Config
│   ├── LICENSE                      # MIT License
│   └── .gitignore                   # Git ignore patterns
│
├── 💻 Source Code
│   └── src/
│       └── index.ts                 # Main connector implementation (TypeScript)
│
├── 🔨 Build Output (generated)
│   └── dist/
│       ├── index.js                 # Compiled JavaScript
│       ├── index.js.map             # Source maps for debugging
│       └── index.d.ts               # TypeScript type definitions
│
├── 🛠️ Scripts
│   └── scripts/
│       └── create-bundle.sh         # Bundle creation script
│
├── 📦 Dependencies (generated)
│   └── node_modules/                # Installed packages
│
└── 🎁 Final Output
    └── universal-cloud-connector.mcpb  # Production bundle (tar.gz)
```

## File Descriptions

### Core Configuration Files

#### `manifest.json`
**Purpose**: Declares the MCP bundle to Claude Desktop
**Key Sections**:
- `name`: Unique identifier (`universal-cloud-connector`)
- `displayName`: User-friendly name in UI
- `description`: What this connector does
- `command` & `args`: How Claude launches it (`node dist/index.js`)
- `configurationSchema`: Configuration UI schema with `server_url` and `api_token`

**When to Edit**:
- Update version number for releases
- Modify display name or description
- Change configuration schema requirements

```json
{
  "mcpVersion": "1.0",
  "name": "universal-cloud-connector",
  "displayName": "Universal Cloud Connector",
  "type": "stdio",
  "command": "node",
  "args": ["dist/index.js"],
  "configurationSchema": {
    "type": "object",
    "properties": {
      "server_url": {...},
      "api_token": {...}
    },
    "required": ["server_url", "api_token"]
  }
}
```

#### `package.json`
**Purpose**: Defines project metadata and npm scripts
**Key Sections**:
- `name` & `version`: Package identity
- `type: "module"`: Uses ES modules
- `scripts`: Available npm commands
- `dependencies`: Runtime dependencies (just `eventsource`)
- `devDependencies`: Build-time dependencies (TypeScript, types)
- `engines`: Minimum Node.js version (18+)

**Available Scripts**:
```json
{
  "build": "tsc",                      // Compile TypeScript
  "start": "node dist/index.js",       // Run connector
  "dev": "ts-node src/index.ts",       // Development mode
  "package": "npm run build && npm run create-bundle",  // Full build
  "create-bundle": "bash scripts/create-bundle.sh"       // Bundle only
}
```

#### `tsconfig.json`
**Purpose**: TypeScript compiler configuration
**Key Options**:
- `target: "ES2020"`: JavaScript version
- `module: "ES2020"`: Module system
- `outDir: "./dist"`: Compiled output location
- `rootDir: "./src"`: Source code location
- `strict: true`: Strict type checking
- `declaration: true`: Generate `.d.ts` files

**When to Edit**: Only if changing TypeScript/build requirements

#### `.gitignore`
**Purpose**: Prevents committing generated files and secrets
**Excludes**:
- `node_modules/` - Dependencies
- `dist/` - Compiled code
- `.env` - Secret environment variables
- `*.mcpb` - Bundle files (rebuild on deployment)

### Documentation Files

#### `README.md`
- **Audience**: First-time users
- **Content**: Overview, features, installation, development
- **When to Read**: Before starting

#### `DEPLOYMENT_GUIDE.md`
- **Audience**: DevOps, cloud engineers
- **Content**: Platform-specific setup, examples, troubleshooting
- **When to Read**: Setting up for production

#### `QUICK_REFERENCE.md`
- **Audience**: Experienced developers
- **Content**: Quick lookup tables, command reference
- **When to Read**: While working with the project

#### `PROJECT_STRUCTURE.md`
- **This file** - Explains the directory layout

### Source Code

#### `src/index.ts`
**The main connector implementation**

**Exports**: None (runs as Node.js process)

**Main Classes**:
```typescript
class UniversalConnector {
  constructor(serverUrl: string, apiToken: string)
  start(): void                          // Begin connector
  private connectSSE(): void             // Establish SSE connection
  private setupStdinListener(): void     // Listen for requests
  private sendRequest(payload): Promise  // Send to remote server
  private getMessagesUrl(): string       // Calculate POST endpoint
}
```

**Flow**:
1. `main()` - Entry point, validates env vars
2. `UniversalConnector.start()` - Begin operation
3. `connectSSE()` - Open SSE listener
4. `setupStdinListener()` - Await Claude requests
5. `sendRequest()` - POST request to remote server
6. Responses received via SSE → written to stdout

**Error Handling**:
- Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s)
- Max 5 retries before giving up
- All errors logged to stderr with timestamps

### Build Output

#### `dist/index.js`
- Compiled JavaScript from `src/index.ts`
- Executable by Node.js 18+
- Entry point defined in `manifest.json`

#### `dist/index.js.map`
- Source map for debugging
- Maps JS back to original TypeScript
- Included for development support

#### `dist/index.d.ts`
- TypeScript type definitions
- Useful if other projects import this module
- Generated automatically from TypeScript

### Scripts

#### `scripts/create-bundle.sh`
**Purpose**: Creates the `.mcpb` distribution bundle

**Steps**:
1. Validates `dist/` and `manifest.json` exist
2. Creates temporary directory
3. Copies files:
   - `manifest.json`
   - `dist/` (compiled code)
   - `package.json` (metadata)
   - `README.md` (documentation)
   - `LICENSE` (copyright)
4. Archives as `.mcpb` (tar.gz format)
5. Displays bundle statistics

**Output**: `universal-cloud-connector.mcpb` (8KB)

**Fallback**: Uses tar if zip unavailable

## Development Workflow

### 1. Clone & Setup
```bash
git clone <repo>
cd universal-cloud-connector
npm install                    # Installs dependencies
```

### 2. Development
```bash
npm run dev                    # Run with ts-node (no build needed)
```

### 3. Build
```bash
npm run build                  # Compiles src/ → dist/
```

### 4. Test
```bash
export server_url="https://your-server/sse"
export api_token="your-token"
npm start                      # Run from dist/
```

### 5. Package
```bash
npm run package               # build + create-bundle
```

### 6. Deploy
```bash
cp universal-cloud-connector.mcpb ~/Library/Application\ Support/Claude/extensions/
# Restart Claude Desktop
```

## Dependency Graph

```
universal-cloud-connector
├── Runtime Dependencies
│   └── eventsource@2.0.2
│       └── (Node.js built-ins)
│
└── Development Dependencies
    ├── typescript@5.3.2
    │   └── (Node.js built-ins)
    ├── @types/node@20.10.0
    │   └── (Type definitions only)
    └── @types/eventsource@1.1.15
        └── (Type definitions only)
```

**Why these?**
- **eventsource**: Only third-party dependency. Handles SSE connections.
- **typescript**: Compiles `.ts` to `.js`
- **Types**: Enable IDE support and type checking

## Configuration Schema (manifest.json)

```
User sees in Claude Desktop:
┌─────────────────────────────────┐
│ Universal Cloud Connector       │
│                                 │
│ Server URL: [________________] │
│                                 │
│ API Token: [________________]   │
│                                 │
│ [Install] [Cancel]              │
└─────────────────────────────────┘

Generated from configurationSchema in manifest.json:
{
  "properties": {
    "server_url": {
      "type": "string",
      "title": "Server URL",
      "format": "uri",
      "examples": ["https://my-vps.com/sse"]
    },
    "api_token": {
      "type": "string",
      "title": "API Token",
      "format": "password"  ← Masked input
    }
  },
  "required": ["server_url", "api_token"]
}
```

## Bundle Structure (.mcpb)

The `.mcpb` file is a tar.gz archive containing:

```
tar -tzf universal-cloud-connector.mcpb

./manifest.json         ← Claude reads this first
./package.json          ← Metadata
./dist/
  └─ index.js          ← Executed by "node" command
  ├─ index.js.map      ← Debug support
  └─ index.d.ts        ← Type info
./README.md             ← Documentation
./LICENSE               ← Licensing
```

When Claude installs the bundle:
1. Extracts to local cache
2. Reads `manifest.json`
3. Sets environment variables from user config
4. Runs: `node dist/index.js`
5. Pipes stdin/stdout/stderr

## File Sizes

| File | Size | Purpose |
|------|------|---------|
| `dist/index.js` | ~6KB | Main code |
| `dist/index.js.map` | ~6KB | Debug info |
| `manifest.json` | ~1.5KB | Configuration |
| `package.json` | ~800B | Metadata |
| **bundle (.mcpb)** | **~8KB** | Compressed archive |

## Environment Variables at Runtime

When Claude launches the connector, it injects:

```bash
export server_url="https://your-configured-url/sse"
export api_token="your-configured-token"

# Then runs:
node dist/index.js

# Connector reads these in src/index.ts:
const SERVER_URL = process.env.server_url;
const API_TOKEN = process.env.api_token;
```

## Communication Channels

```
Claude Desktop
├─ stdout    ← Connector writes JSON-RPC responses here
├─ stdin     ← Claude sends JSON-RPC requests here
└─ stderr    ← Connector logs diagnostics here

Remote MCP Server
├─ GET /sse  ← Connector connects with EventSource
└─ POST /messages  ← Connector sends requests here
```

## Git Workflow

```
.gitignore excludes:
  - node_modules/        (install locally)
  - dist/                (rebuild locally)
  - *.mcpb               (generate locally)
  - .env                 (secrets)

Commit to git:
  - src/index.ts         (source code)
  - manifest.json        (config)
  - package.json         (dependencies)
  - tsconfig.json        (compiler config)
  - scripts/             (build scripts)
  - *.md                 (documentation)
  - LICENSE              (legal)
```

## Maintenance Tasks

### Weekly
- Check for dependency updates: `npm outdated`
- Review server logs for errors

### Monthly
- Update dependencies: `npm update`
- Run security audit: `npm audit`

### Quarterly
- Review and update documentation
- Test connector with different server configurations

## Extending the Project

### Adding Configuration Options

1. Edit `manifest.json` `configurationSchema`
2. Read in `src/index.ts` from `process.env`
3. Use in connector logic

### Adding New Features

1. Modify `src/index.ts`
2. Rebuild: `npm run build`
3. Test: `export server_url=... && npm start`
4. Package: `npm run package`

### Publishing Updates

1. Update version in `package.json` and `manifest.json`
2. Update `README.md` and `DEPLOYMENT_GUIDE.md`
3. Commit: `git add . && git commit -m "v1.1.0"`
4. Create bundle: `npm run package`
5. Release: Upload `.mcpb` file

---

**Next**: Start with [README.md](README.md) or jump to [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)!
