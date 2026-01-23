# Flutter Deep Linking Integration & Action Items

**IMPORTANT**: This guide outlines the steps to implement Deep Linking for profile sharing in the Flutter app. To finalize the backend configuration, you (the Flutter Developer) must provide specific credentials.

## PART 1: ACTION REQUIRED FROM FLUTTER TEAM

We need the following details to update the web server's verification files (`assetlinks.json` and `apple-app-site-association`). **Please reply with these values:**

### Android Details
1.  **Package Name**:
    *   `com.example.weddingzon`
2.  **SHA-256 Certificate Fingerprint**:
    *   `95:B2:9C:AD:3F:0C:97:0B:DE:5C:75:2D:76:75:98:C1:7D:52:33:CF:EC:60:82:62:9A:D7:83:FE:65:23:33:94`
3.  **Note**: This information has been updated in `assetlinks.json`.
    *   Run `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` (Mac/Linux) or verify in Android Studio.
    *   *Why?* Needed for deep linking to work during local development.

### iOS Details
1.  **Bundle ID**:
    *   Find in Xcode -> Runner -> General -> Bundle Identifier.
    *   *Example: com.weddingzon.app*
2.  **Apple Team ID**:
    *   Find in Apple Developer Portal (Membership Details).
    *   *Example: 7K552XXXX*

---

## PART 2: IMPLEMENTATION GUIDE

Once you provide the above IDs, we will update the server. In the meantime, configure your app to handle the incoming links: `https://dev.d34g4kpybwb3xb.amplifyapp.com/[username]`

### Step 1: Add Dependencies
Add `app_links` to `pubspec.yaml` (Recommended for Android 12+ support):
```yaml
dependencies:
  app_links: ^6.3.0
```

### Step 2: Android Configuration
Open `android/app/src/main/AndroidManifest.xml` and add the intent filter inside the main `<activity>`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <!-- Replace with your actual domain if different -->
    <data android:scheme="https" android:host="dev.d34g4kpybwb3xb.amplifyapp.com" />
</intent-filter>
```

### Step 3: iOS Configuration
1.  Open `ios/Runner.xcworkspace` in Xcode.
2.  Go to **Signing & Capabilities**.
3.  Click **+ Capability** and select **Associated Domains**.
4.  Add the following domains:
    *   `applinks:dev.d34g4kpybwb3xb.amplifyapp.com`

### Step 4: Dart Implementation (Link Handling)
In your `main.dart` or root widget:

```dart
import 'package:app_links/app_links.dart';

// ... inside your State class

  final _appLinks = AppLinks();

  @override
  void initState() {
    super.initState();
    initDeepLinks();
  }

  Future<void> initDeepLinks() async {
    // 1. Handle Cold Start (App opened from terminated state)
    final initialUri = await _appLinks.getInitialLink();
    if (initialUri != null) {
      _handleDeepLink(initialUri);
    }

    // 2. Handle Running App (App is in background/foreground)
    _appLinks.uriLinkStream.listen((uri) {
      _handleDeepLink(uri);
    });
  }

  void _handleDeepLink(Uri uri) {
    print("Received Deep Link: $uri");
    // Parse path: https://weddingzon.com/[username]
    if (uri.pathSegments.isNotEmpty) {
      final username = uri.pathSegments.first;
      
      // TODO: Navigate to Profile Screen
      // Navigator.pushNamed(context, '/profile', arguments: username);
    }
  }
```

## PART 3: EDGE CASES TO HANDLE

    *   If a link is clicked but the user is logged out, the app should likely redirect to a Login Screen.
    *   **Crucial**: You must manually implement the "Redirect Back" logic.
    *   **Implementation Pattern**:
        1.  When deep link is received checks auth state.
        2.  If not auth, save the path (e.g., `_pendingRoute = '/profile/john'`) in a Singleton/Provider.
        3.  Redirect to `/login`.
        4.  After successful login (in your `LoginBloc` or `AuthProvider`), check if `_pendingRoute` is set.
        5.  If set, `Navigator.pushReplacementNamed(_pendingRoute)`.

    ```dart
    // Example Logic in your Auth Provider/Bloc
    void handleLoginSuccess(BuildContext context) {
       if (PendingLinkService.hasPendingLink) {
          final path = PendingLinkService.popLink();
          Navigator.pushReplacementNamed(context, path);
       } else {
          Navigator.pushReplacementNamed(context, '/home');
       }
    }
    ```
2.  **User Not Found**:
    *   Handle 404s gracefully if the backend returns "Profile Not Found".
3.  **App Not Installed**:
    *   We handle this on the web side. Users clicking the link without the app will see the mobile-responsive website with a "Download App" banner.

## PART 4: BACKEND & WEB FALLBACK (Action Items)

This section outlines the tasks the Backend Developer (Antigravity) will implement to support the edge cases.

### 1. Handling "User Not Logged In"
**Scenario**: User clicks link, App opens, but valid token missing.
**Backend Support**:
- [ ] **Public Profile Preview Endpoint**: Create `GET /api/users/:username/public-preview`.
    - **Returns**: `first_name`, `last_name`, `profilePhoto` (blurred if needed), `role`.
    - **Usage**: Use this to show "Login to view [Name]'s full profile" instead of a blank login screen.
    - **Security**: No sensitive data returned.

### 2. Handling "Profile Not Found / Banned"
**Scenario**: Link contains invalid username or banned user.
**Backend Support**:
- [ ] **Standardized Error Codes**: The `/api/users/:username` endpoint will return:
    - `404 Not Found` -> Code: `USER_NOT_FOUND`
    - `403 Forbidden` -> Code: `USER_BANNED` or `USER_SUSPENDED`
    - **Action**: App should show appropriate error screen based on `code`.

### 3. Handling "App Not Installed" (Web Fallback)
**Scenario**: User doesn't have app, link opens in browser (`https://weddingzon.com/username`).
**Web Support (Next.js)**:
- [ ] **Smart App Banner**: Add `<meta name="apple-itunes-app" ...>` and Android equivalent.
- [ ] **Redirect Logic**: The web page will attempt to redirect to `weddingzon://` scheme (optional) or just show the profile with a "View in App" sticky button.
- [ ] **Deferred Context**: If they install via the web banner, we can't easily preserve the deep link context without Firebase/Branch, but they will land on the feed/login and have to click the link again. This is standard behavior for basic App Links.

### 4. Handling "Blocked Users" (Future Implementation)
**Scenario**: User A blocks User B. User B gets a link to User A's profile.
**Backend Support**:
- [ ] **Block Check**: The `/api/users/:username` and `/api/users/:username/public-preview` endpoints will check a `BlockList` collection (to be implemented).
    - **Returns**: `403 Forbidden` -> Code: `USER_BLOCKED`
    - **Action**: App shows "You cannot view this profile."

### 5. Handling "Rate Limiting" (Security)
**Scenario**: Malicious user/bot spams deep links to scrape data.
**Backend Support**:
- [ ] **Rate Limiter**: Apply specific `express-rate-limit` on the public preview endpoint.
    - **Limit**: e.g., 50 requests per IP per 15 mins.
    - **Action**: Backend returns `429 Too Many Requests`. App should handle this gracefully (e.g., "Try again later").

### 6. Handling "Account Deactivation"
**Scenario**: User temporarily deactivates account (distinct from Ban).
**Backend Support**:
- [ ] **Status Check**: Update `getUserProfile` to handle `status: 'deactivated'`.
    - **Returns**: `404 Not Found` (for privacy) or `410 Gone`.
    - **Action**: Frontend treats same as Not Found.

### 7. Handling "Network/Server Errors" (App Resilience)
**Scenario**: Backend is down (500) or timeout.
**Backend Support**:
- [ ] **Health Check**: Ensure `/health` endpoint is robust.
- [ ] **App Logic**: Flutter app *must* catch generic exceptions (5xx) when resolving specific links and fallback to the Home/Feed screen instead of crashing.

### 8. Handling "Username Changes" (Legacy Links)
**Scenario**: User changes their username from `@john` to `@johnny`. Old links (`/john`) now return 404.
**Backend Support**:
- [ ] **Username History**: Create a collection to track previous usernames.
    - **Logic**: If `User.findOne({username})` fails, check `UsernameHistory`.
    - **Action**: Return `301 Moved Permanently` with the new profile data, or a `redirect_to` field in the JSON response so the App can update the UI to the new name.

### 9. Handling "Self-Deep-Linking" (UX Pattern)
**Scenario**: User is logged in as `@john` and clicks a link to `weddingzon.com/john`.
**App Support**:
- [ ] **Identity Check**: The App should compare the `targetUsername` from the link with the `currentAuthUser.username`.
    - **Action**: If they match, navigate to **"My Profile" (Edit Mode)** instead of "Public Profile" (View Mode). Do not treat yourself as a stranger.

### 10. Handling "Social Media Crawlers" (Rich Previews)
**Scenario**: Link is shared on WhatsApp/iMessage. These apps use bots to fetch "Open Graph" metadata.
**Backend/Web Support**:
- [ ] **Bot Optimization**: Ensure the Web Fallback page (`[username]/page.tsx`) renders metadata *server-side* (SSR) extremely fast.
- [ ] **Image Resizing**: Social platforms often reject images >300KB or specific aspect ratios. The public preview endpoint should serve a dedicated `og:image` optimized for sharing (1200x630px).

### 11. Handling "Offline Mode"
**Scenario**: User clicks link while in Airplane mode.
**App Support**:
- [ ] **Cache fallback**: App should show a specific "No Internet" screen for deep links, allowing a "Retry" action. Do not show a generic "User Not Found".
