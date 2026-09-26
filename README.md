# NexusAI - Multi-User Integration Platform

NexusAI is a production-grade, multi-user AI platform with an AES-256-GCM encrypted credential vault, persistent SQLite database, and strict tenant isolation. Each user connects and utilizes their own Google Workspace (Gmail, Google Calendar, Google Drive), webhooks, and third-party tools.

Author: **Sathish Kani** (`psathishkani@gmail.com`)

---

## 🚀 GitHub Repository Deployment Guide

To deploy this repository to your GitHub account (`psathishkani@gmail.com`):

### 1. Create a New Repository on GitHub
1. Go to [https://github.com/new](https://github.com/new)
2. Repository name: `nexusai` (or your preferred name)
3. Visibility: **Public** or **Private**
4. Do **not** initialize with a README, .gitignore, or license (already included in this project)
5. Click **Create repository**

### 2. Push Code from Terminal
Run the following commands in the project directory:

```bash
# Set author configuration
git config user.name "Sathish Kani"
git config user.email "psathishkani@gmail.com"

# Add your GitHub remote repository (replace with your repo URL)
git remote add origin https://github.com/<your-username>/nexusai.git

# Set default branch to main and push
git branch -M main
git push -u origin main
```

*(If you use GitHub Personal Access Token or SSH, substitute `git@github.com:<your-username>/nexusai.git` as your remote URL).*

---

## 🛡️ Multi-User Architecture & Security Invariants

- **Multi-Tenant Isolation**: Every integration record, webhook, idempotency key, rate limit, and audit log belongs strictly to a unique authenticated `user_id`. Backend endpoints derive `user_id` directly from the HMAC-SHA256 session token (`req.userId`), never trusting client-supplied values.
- **AES-256-GCM Vault**: Provider access and refresh tokens are encrypted at rest using AES-256-GCM with a server-side `ENCRYPTION_SECRET`. Plaintext tokens never reach the browser or logs.
- **Minimum Privilege Scopes**:
  - Gmail: `https://www.googleapis.com/auth/gmail.readonly`
  - Google Calendar: `https://www.googleapis.com/auth/calendar.events.readonly`
  - Google Drive: `https://www.googleapis.com/auth/drive.readonly`
- **SSRF-Protected Webhooks**: User webhooks are validated to block `localhost`, `127.0.0.1`, `169.254.169.254` (cloud metadata endpoints), and private networks.
- **Per-User AI Quota & Rate Limiting**: Built-in tracking prevents abuse of the server-side OpenRouter API key.

---

## ⚙️ Environment Variables (`.env`)

```env
# Server-Side OpenRouter API Key (never exposed to frontend)
OPENROUTER_API_KEY="your-openrouter-api-key"

# Default AI Model
DEFAULT_AI_MODEL="anthropic/claude-opus-5.5"

# Application Base URL & Port
APP_URL="http://localhost:3000"
PORT=3000

# 32-byte (64-character) hex encryption key for AES-256-GCM vault
ENCRYPTION_SECRET="replace-with-a-unique-random-64-character-hex-secret"

# 32-byte (64-character) hex secret for signing HMAC-SHA256 session tokens
AUTH_SECRET="replace-with-a-unique-random-64-character-hex-secret"

# Google Cloud OAuth 2.0 Web Client Credentials
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/integrations/google/callback"
```

---

## 📦 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run type check and lint
npm run lint

# Build for production
npm run build

# Start production server
npm start
```
