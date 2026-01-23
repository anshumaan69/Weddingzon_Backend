# Deep Linking Documentation – WeddingZon

> **Goal**: Enable seamless profile sharing across WhatsApp and social platforms such that:
>
> 1. The **WeddingZon mobile app opens directly** if installed.
> 2. The **web profile opens as a fallback** if the app is not installed, with a strong CTA to download the app.

This implementation follows **industry-grade standards** using:

* **Android App Links** (Google-recommended)
* **iOS Universal Links** (Apple-recommended)

These approaches are secure, reliable, and immune to browser-blocking issues common with custom URL schemes.

---

## 1. High-Level Architecture

Deep linking works by **verifying domain ownership** so the OS trusts your app to open specific URLs.

### Domain Ownership Proof

* **Android** → `assetlinks.json`
* **iOS** → `apple-app-site-association`

Both files are hosted on your **primary domain**:

```
https://weddingzon.com/.well-known/
```

### End-to-End Flow

1. User shares a profile URL:

   ```
   https://weddingzon.com/profile/12345
   ```
2. Recipient taps the link.
3. OS checks verified domain association:

   * ✅ **App Installed** → App opens directly to profile `12345`.
   * ❌ **App Not Installed** → Browser opens the web profile.
4. Web page displays content + **Download App CTA**.

> ⚠️ No JS hacks, no install detection, no redirects. OS handles everything.

---

## 2. URL Strategy (Critical Design Decision)

### ✅ Always Share Web URLs

```
https://weddingzon.com/profile/{profileId}
```

### ❌ Avoid

* `weddingzon://profile/12345`
* JavaScript-based redirects
* Timed store redirects

**Why?**

* WhatsApp, Instagram, Gmail aggressively block non-HTTP schemes.
* Universal/App Links are the only future-proof solution.

---

## 3. Web Configuration (Next.js)

Your web app is the **fallback layer** when the app is not installed.

### 3.1 Android – `assetlinks.json`

**Path**:

```
client/public/.well-known/assetlinks.json
```

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.weddingzon.app",
      "sha256_cert_fingerprints": [
        "YOUR_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

📌 Notes:

* SHA256 must match the **signing key** (Play Console → App Integrity).
* If using Play App Signing, use the **App Signing Certificate**, not upload key.

---

### 3.2 iOS – `apple-app-site-association`

**Path (no extension)**:

```
client/public/.well-known/apple-app-site-association
```

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.weddingzon.app",
        "paths": [
          "/profile/*",
          "/user/*"
        ]
      }
    ]
  }
}
```

📌 Notes:

* Must be served with `application/json` MIME type.
* No redirects, no auth, no compression issues.

---

## 4. Web Fallback UX (Conversion Layer)

When the app is not installed, the **website must convert the user**.

### Recommended UX

* Show profile content immediately (SEO + trust)
* Display a **non-intrusive app banner**
* Avoid forced redirects to app stores

### Example (Next.js – App Router)

```tsx
// app/profile/[id]/page.tsx
import Link from 'next/link';

export default function ProfilePage({ params }) {
  return (
    <div>
      {/* App CTA – Mobile Only */}
      <div className="md:hidden sticky top-0 bg-pink-100 p-3 text-center z-50">
        <p className="text-sm mb-2">Better experience on the WeddingZon App 💍</p>
        <Link
          href="https://play.google.com/store/apps/details?id=com.weddingzon.app"
          className="inline-block bg-pink-600 text-white px-4 py-2 rounded-full"
        >
          Open in App
        </Link>
      </div>

      {/* Profile Content */}
      <ProfileDetails id={params.id} />
    </div>
  );
}
```

---

## 5. Flutter Mobile App Configuration

### 5.1 Dependency

```yaml
dependencies:
  app_links: ^3.4.0
```

---

### 5.2 Android Setup

**File**: `android/app/src/main/AndroidManifest.xml`

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />

    <data android:scheme="https"
          android:host="weddingzon.com"
          android:pathPrefix="/profile" />

    <data android:scheme="https"
          android:host="www.weddingzon.com"
          android:pathPrefix="/profile" />
</intent-filter>
```

📌 `android:autoVerify="true"` enables OS-level verification.

---

### 5.3 iOS Setup

1. Open `ios/Runner.xcworkspace` in Xcode
2. Go to **Signing & Capabilities**
3. Add **Associated Domains** capability
4. Add:

   ```
   applinks:weddingzon.com
   ```

⚠️ Reinstall app after any change.

---

## 6. Flutter Deep Link Handling Logic

### Centralized Deep Link Service

```dart
import 'package:app_links/app_links.dart';

class DeepLinkService {
  final AppLinks _appLinks = AppLinks();

  void init() {
    // Cold start
    _appLinks.getInitialLink().then((uri) {
      if (uri != null) _handle(uri);
    });

    // Warm start
    _appLinks.uriLinkStream.listen((uri) {
      _handle(uri);
    });
  }

  void _handle(Uri uri) {
    if (uri.pathSegments.contains('profile')) {
      final profileId = uri.pathSegments.last;
      print('Navigating to profile: $profileId');
      // Navigator / GetX / GoRouter
    }
  }
}
```

📌 Initialize this in `main()` or `SplashController`.

---

## 7. Testing & Verification Checklist

### Web

* [ ] `/.well-known/assetlinks.json` accessible
* [ ] `/.well-known/apple-app-site-association` accessible
* [ ] Correct MIME type (`application/json`)

### Android

* [ ] App installed via Play Store
* [ ] `adb shell pm get-app-links com.weddingzon.app`
* [ ] Logcat shows verification success

### iOS

* [ ] App reinstalled
* [ ] Universal Link opens app from Notes/Safari

---

## 8. Analytics & Growth (Recommended)

Track deep link performance:

* UTM params on shared URLs
* App-side event: `deep_link_opened`
* Web-side event: `app_not_installed_fallback`

Example:

```
https://weddingzon.com/profile/12345?utm_source=whatsapp
```

---

## 9. Security & Best Practices

* Never expose internal user IDs directly if sensitive
* Validate profile access server-side
* Rate-limit profile APIs
* Avoid dynamic redirect services unless needed

---

## 10. Final Summary

✔ Share **only HTTPS web URLs**
✔ OS decides app vs browser
✔ Website handles fallback
✔ No hacks, no race conditions
✔ Fully compliant with Apple & Google policies

This architecture is **scalable, secure, and production-ready** for WeddingZon.
