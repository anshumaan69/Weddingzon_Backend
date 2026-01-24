# WeddingZon Flutter Master Guide

This guide details the architecture, dependencies, and feature implementation steps to build the WeddingZon mobile application, mirroring the web functionality.

## 1. Project Architecture
**Recommended Pattern**: MVVM (Model-View-ViewModel) with Repository Pattern.
- **Provider** or **Riverpod** for State Management.
- **GoRouter** for Navigation.
- **Dio** for HTTP requests (with Interceptors).

## 2. Core Dependencies
Add these to `pubspec.yaml`:
```yaml
dependencies:
  flutter:
    sdk: flutter
  # State Management
  flutter_riverpod: ^2.4.9 (or provider)
  # Networking
  dio: ^5.4.0
  # Navigation
  go_router: ^12.1.0
  # Storage
  shared_preferences: ^2.2.2
  flutter_secure_storage: ^9.0.0
  # UI/Assets
  cached_network_image: ^3.3.0
  google_fonts: ^6.1.0
  flutter_svg: ^2.0.9
  # Forms
  flutter_form_builder: ^9.1.1
  # Location
  geolocator: ^10.1.0
  geocoding: ^2.1.1
  # Socket
  socket_io_client: ^2.0.3
  # UI Components
  flutter_card_swiper: ^7.0.0 (For Feed)
```

## 3. API Integration Layer
Create a `DioService` singleton.
- **Base URL**: `https://api.weddingzon.com/api` (or local IP for dev).
- **Interceptors**:
    - **Request**: Attach `Authorization: Bearer <token>` from secure storage.
    - **Response**: Handle `401 Unauthorized` (Token Expiry) -> Attempt Refresh -> Retry or Logout.

## 4. Feature Implementation

### A. Authentication & Onboarding
1.  **Login Screen**:
    -   **Google Sign-In**: Use `google_sign_in` package. Send `idToken` to `POST /auth/google`.
    -   **Phone Login**: Input Phone -> `POST /auth/send-otp` -> Input OTP -> `POST /auth/verify-otp`.
2.  **Onboarding Logic**:
    -   After login, check `user.is_profile_complete`.
    -   If `false`, redirect to **Onboarding Stepper**.
    -   **Steps**: Basic -> Location -> Family -> Education -> Religion -> Lifestyle -> Photos.
    -   **Location**: Implement "Get My Location" using `geolocator`. Reverse geocode to get City/State/Country.
    -   **Completion**: Send `is_profile_complete: true` in the final step.

### B. Dynamic Feed (Home)
-   **Endpoint**: `GET /users/feed?cursor=...` (Infinite Scroll).
-   **UI**: Tinder-style Swipe Cards (`flutter_card_swiper`) or Vertical List.
-   **Action**: Clicking a user navigates to `ProfileDetailScreen`.

### C. Search & Explore (Dynamic Filters)
**Crucial**: The filter UI is NOT hardcoded. It is driven by the backend.
1.  **Fetch Config**: Call `GET /api/filters` on init.
2.  **Render UI**:
    -   Map through the response list.
    -   `type: 'select'` -> Dropdown/BottomSheet.
    -   `type: 'range'` -> Range Slider (e.g., Age 18-60).
    -   `type: 'text'` -> TextField.
3.  **Execute Search**:
    -   Collect values into a Query Map.
    -   Call `GET /users/search?key=value...`.

### D. User Profile
1.  **View**: Fetch details via `GET /users/:username`.
2.  **Photos**:
    -   **Gallery**: Display `user.photos`. Handle `restricted: true` (Blur image).
    -   **Access**: If restricted, show "Request Photo Access" button (`POST /connections/request-photo-access`).
3.  **Actions**:
    -   **Connect**: `POST /connections/send`.
    -   **Block**: `POST /users/block` (in overflow menu).
    -   **Report**: `POST /users/report`.

### E. Connections & Requests
**Separate Tab**. Do not mix with Home/Feed.
1.  **My Connections**: `GET /connections/my-connections`. List of friends.
2.  **Requests**: `GET /connections/requests`.
    -   Tabs: "Connection Requests", "Photo Requests", "Details Requests".
    -   Actions: Accept/Reject buttons.

### F. Chat (Real-time)
1.  **Socket Connection**: Connect to `/` with `auth: { token: '...' }`.
2.  **Events**:
    -   Listen for `receive_message`.
    -   Emit `send_message`.
3.  **UI**: Bubble interface. Support Image Upload (`POST /chat/upload` -> send URL via socket).

### G. Edit Profile & Photo Management
1.  **Edit**: Re-use Onboarding forms but pre-filled.
2.  **Photo Upload Queue** (Important for Mobile):
    -   Implement a sequential queue for uploads to avoid timeouts.
    -   Show optimistic UI (local image) while uploading.
    -   Endpoint: `POST /users/upload-photos`.

## 5. Safety & error Handling
-   **Photo URLs**: Remember they are pre-signed and expire. Refresh list on pull-to-refresh.
-   **Blocked Users**: Filter them out locally if the API returns them by mistake (double safety).
-   **Deduplication**: Ensure Feed/Lists don't show duplicates using Set logic.

## 6. Franchise Features
-   **PDF Generation**: If user role is `franchise`, show "Generate PDF" button on profiles.
-   **Action**: Call `GET /franchise/custom-matches/:id/pdf`. Open URL in external browser or PDF viewer.
