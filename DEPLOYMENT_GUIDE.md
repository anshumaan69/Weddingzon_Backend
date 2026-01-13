WEDDINGZON DEPLOYMENT GUIDE
===========================

This guide details the build and deployment process for the WeddingZon platform, comprising three distinct components.

--------------------------------------------------------------------------------
1. COMPONENT OVERVIEW
--------------------------------------------------------------------------------

A. BACKEND (`Weddingzon_Backend`)
   - Technology: Node.js / Express
   - Port: 5000 (Default)
   - Function: API, Database Connection, Auth, Business Logic.

B. MAIN FRONTEND (`Weddingzon_Web_Final/client`)
   - Technology: Next.js (16.1.1)
   - Port: 3000 (Default)
   - Function: Public User Interface (Landing, Feed, Profile).

C. ADMIN PORTAL (`Weddingzon_Admin/client`)
   - Technology: Next.js (16.1.1)
   - Port: 3001 (Recommended to avoid conflict)
   - Function: Administration, Statistics, User Management.

--------------------------------------------------------------------------------
2. ENVIRONMENT VARIABLES (.env)
--------------------------------------------------------------------------------
Ensure these variables are set in your deployment environment (CI/CD, Vercel, Railway, etc.).

BACKEND (.env)
--------------
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://...           # Production Database
client_URL=https://your-frontend.com  # CORS Origin
JWT_SECRET=strong_secret_key
REFRESH_TOKEN_SECRET=strong_refresh_key
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CALLBACK_URL=https://your-backend.com/api/auth/google
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_SERVICE_SID=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

FRONTEND (.env.local)
---------------------
NEXT_PUBLIC_API_URL=https://your-backend.com/api
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...      # Must match Backend ID

ADMIN PORTAL (.env.local)
-------------------------
NEXT_PUBLIC_API_URL=https://your-backend.com/api

--------------------------------------------------------------------------------
3. BUILD & START COMMANDS
--------------------------------------------------------------------------------

A. DEPLOYING BACKEND
   1. Install Dependencies:
      `npm install`
      
   2. Build (No compile step for Node.js, but ensure linting passes):
      `npm run test` (If tests exist)
      
   3. Start Server:
      `npm start` 
      (Runs `node src/server.js`)

   *Process Manager Recommendation*: Use `pm2` for production resilience.
   `pm2 start src/server.js --name weddingzon-backend`

B. DEPLOYING FRONTEND (MAIN)
   1. Install Dependencies:
      `npm install --legacy-peer-deps` (If dependency conflicts arise)
      
   2. Build Application:
      `npm run build`
      (Generates optimized `.next` folder)
      
   3. Start Application:
      `npm start`
      (Runs `next start` on Port 3000)

C. DEPLOYING ADMIN PORTAL
   1. Install Dependencies:
      `npm install`
      
   2. Build Application:
      `npm run build`
      
   3. Start Application:
      `npm start`
      (Runs `next start` on Port 3000 by default. Use PORT variable to change)
      Example: `PORT=3001 npm start`

--------------------------------------------------------------------------------
4. INFRASTRUCTURE NOTES
--------------------------------------------------------------------------------
- **Reverse Proxy**: Use Nginx or Apache to route traffic.
  - `domain.com` -> Frontend (Port 3000)
  - `admin.domain.com` -> Admin (Port 3001)
  - `api.domain.com` -> Backend (Port 5000)
  
- **SSL**: Ensure HTTPS is enabled for all domains. Cookies are set with `SameSite=None` and `Secure=true` in production, which require HTTPS to work.
- **Database**: Ensure MongoDB IP Whitelist includes your production server IP.
