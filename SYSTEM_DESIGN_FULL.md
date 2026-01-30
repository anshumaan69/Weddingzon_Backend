# WeddingZon System Design

## 1. High-Level Architecture

WeddingZon uses a microservice-ready modular monolith architecture. The frontend is built with Next.js (hosted on AWS Amplify), while the backend is an Express.js application (hosted on AWS EC2), connecting to MongoDB Atlas and AWS S3.

```mermaid
graph TD
    User[User (Browser/Mobile)] -->|HTTPS| CloudFront[AWS CloudFront]
    CloudFront -->|Frontend Assets| Amplify[AWS Amplify (Next.js)]
    CloudFront -->|API Requests| ALB[Application Load Balancer / Nginx]
    
    subgraph "Backend Infrastructure (EC2)"
        ALB -->|Reverse Proxy| NodeApp[Node.js + Express Server]
        NodeApp -->|Auth| GoogleAuth[Google OAuth]
        NodeApp -->|Storage| S3[AWS S3 (Images)]
        NodeApp -->|Database| MongoDB[(MongoDB Atlas)]
        NodeApp -->|Real-time| SocketIO[Socket.io Server]
    end

    subgraph "Admin Infrastructure"
        AdminUser[Admin User] -->|HTTPS| AdminPortal[Admin Portal (Next.js)]
        AdminPortal -->|API Requests| ALB
    end
```

## 2. Technology Stack

### Frontend (User & Admin)
- **Framework**: Next.js 16.1.1 (React 19)
- **Language**: TypeScript / JavaScript
- **Styling**: TailwindCSS
- **State Management**: React Context (Cart, Auth)
- **Deployment**: AWS Amplify

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Real-time**: Socket.io
- **Storage**: AWS S3 (via `@aws-sdk/client-s3`)
- **Authentication**: JWT (Access/Refresh Tokens) + Google OAuth
- **Deployment**: AWS EC2 (PM2 + Nginx)

## 3. Module Design

### 3.1 Authentication Module
Handles user login via Google and traditional credentials, session management via JWT.

**Key APIs:**
- `POST /api/auth/google`: Exchange ID token/code for JWT.
- `POST /api/auth/refresh`: Rotate access tokens.

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Google
    participant DB

    Client->>Google: Login with Google
    Google-->>Client: ID Token / Auth Code
    Client->>API: POST /api/auth/google {code/idToken}
    API->>Google: Verify Token
    Google-->>API: User Profile (Email, Name)
    API->>DB: Find or Create User
    API-->>Client: Set Cookies (Access: 30d, Refresh: 30d)
```

### 3.2 User Profile & Feed Module
Manages user profiles, preferences, and the matchmaking feed.

**Key APIs:**
- `GET /api/users/feed`: Smart algorithm to fetch potential matches.
- `GET /api/users/:username`: fetch profile details.
- `POST /api/users/upload-photos`: S3 integration.

```mermaid
graph LR
    Req[Feed Request] --> Auth[Auth Middleware]
    Auth --> Controller[Feed Controller]
    Controller --> Filter[Apply Preferences]
    Filter --> Exclude[Exclude Blocked/Connected]
    Exclude --> DB[(Fetch Users)]
    DB --> Client[Return List]
```

### 3.3 Connection Module
Handles the state machine of user relationships (Pending, Accepted, Rejected).

```mermaid
stateDiagram-v2
    [*] --> None
    None --> Pending: Send Request
    Pending --> Accepted: Accept
    Pending --> Rejected: Reject
    Accepted --> [*]
    Rejected --> [*]
    Pending --> None: Cancel
    Accepted --> None: Remove Connection
```

### 3.4 Franchise Module
Allows franchise owners to manage profiles on behalf of users.

**Workflow:**
1. Franchise registers and gets approved by Admin.
2. Franchise creates sub-profiles (`created_for: franchise`).
3. Franchise manages photos and preferences for these profiles.

### 3.5 E-Commerce (Shop) Module
Users can buy wedding-related products from vendors.

## 4. Database Schema (Simplified)

```mermaid
erDiagram
    User ||--o{ Connection : initiates
    User ||--o{ Connection : receives
    User ||--o{ Product : sells
    User ||--o{ Cart : owns
    
    User {
        ObjectId _id
        String username
        String email
        String role
        Object franchise_details
        Object vendor_details
    }

    Connection {
        ObjectId fromUser
        ObjectId toUser
        String status
        Date createdAt
    }

    Product {
        ObjectId vendor
        String name
        Number price
        String category
    }
```

## 5. Deployment & Configuration

**Nginx Configuration (Crucial for Images)**:
To support large image uploads, the Nginx reverse proxy must be configured:

```nginx
server {
    listen 80;
    server_name api.weddingzon.com;

    client_max_body_size 100M; # FIX 413 Error

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
