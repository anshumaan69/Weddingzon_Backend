# WeddingZon Flutter Implementation Rules

This guide outlines the specific logic and API requirements for the Flutter application to match the web application's functionality.

## 1. Profile Completion Logic (`isProfileComplete`)

The backend requires `is_profile_complete: true` to be sent **explicitly** when the user finishes the onboarding flow.

-   **Endpoint**: `POST /api/auth/register-details`
-   **When to send**: On the final step of onboarding (e.g., after Photos or About Me).
-   **Payload**:
    ```json
    {
       // ... other fields (about_me, etc.)
       "is_profile_complete": true
    }
    ```
-   **Logic**: The backend will only set this flag to `true` if essential fields (`first_name`, `dob`, `gender`, `religion`, `about_me`) are present in the database. Ensure these are collected before sending the flag.

## 2. Recording Profile Views

Views are not automatically recorded when fetching a profile. You must explicitly call the view endpoint when a user visits another user's profile screen.

-   **Endpoint**: `POST /api/users/view/:userId`
-   **Method**: `POST`
-   **Trigger**: Call this in the `initState` or `onPending` logic of your Profile Detail screen.
-   **Constraints**:
    -   Self-views are ignored by backend.
    -   Views are rate-limited to 1 per day per user pair (handled by backend).
-   **Response**: `200 OK` (Silent success).

## 3. "Get My Location" (Onboarding)

The "Get My Location" button in Onboarding > Location Details should follow this flow:

1.  **Request Permission**: specific to iOS/Android.
2.  **Get Coordinates**: Retrieve User's Latitude/Longitude.
3.  **Reverse Geocoding (Client Side)**:
    -   **Provider**: Use `geocoding` package or OpenStreetMap API (like the web app does).
    -   **URL**: `https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}`
    -   **Map Fields**:
        -   `address.country` -> `country`
        -   `address.state` OR `address.region` -> `state`
        -   `address.city` OR `address.town` OR `address.village` -> `city`
4.  **Backend Update 1 (Text)**:
    -   Fill these text values into the Onboarding Form state.
    -   User can edit them manually if needed.
    -   Send as part of `POST /api/auth/register-details` or `POST /api/auth/register-details` (auto-save).
5.  **Backend Update 2 (Coordinates - Background)**:
    -   Send coordinates to `PATCH /api/users/location` to enable "Nearby Users" features.
    -   **Payload**: `{ "latitude": 12.34, "longitude": 56.78 }`

## 4. Profile Photos in Notifications & Connections

**Issue Fixed**: The backend was previously returning unsigned (broken) URLs for `profilePhoto` in these lists. This has been patched.

-   **API Endpoints**:
    -   `GET /api/connections/notifications` (Notifications)
    -   `GET /api/connections/requests` (Incoming Requests)
    -   `GET /api/connections/my-connections` (Connections List)
-   **Data Handling**:
    -   The `profilePhoto` field in the response (inside `otherUser`, `requester`, or the root object depending on endpoint) is now a **Pre-Signed S3 URL**.
    -   **Important**: These URLs expire (15 mins). Do **not** cache them permanently on the device. Re-fetch the list on app launch or pull-to-refresh.
    -   **Display**: Use `CachedNetworkImage` with a placeholder, but rely on API refreshing for valid tokens.

## 5. Connections Page (Standalone)

The Connections page should be a separate tab or top-level view, distinct from "Matches" or "Search".

-   **Endpoint**: `GET /api/connections/my-connections`
-   **UI Layout**:
    -   List View of Connected Users.
    -   **Card Details**:
        -   Profile Photo (Circular/Avatar)
        -   Name (`first_name` + `last_name`)
        -   Occupation (e.g., "Software Engineer")
        -   Age (Calculated from DOB or provided in helper field `age`)
        -   Location (`city`, `state`)
    -   **Actions**:
        -   **Chat**: Button to open Chat Screen (since connection is `accepted`).
        -   **View Profile**: Tap card to open full profile.
-   **Logic**:
    -   This list represents *mutual* acceptance.
    -   Users here have full access to each other's details/photos (unless restricted by specific block logic, though usually connection implies trust).

---

### Summary Checklist for Dev
- [ ] Add `is_profile_complete: true` to final onboarding save.
- [ ] Add `POST /api/users/view/:id` on profile open.
- [ ] Implement Geocoding + `PATCH /api/users/location` for "Get My Location".
- [ ] Verify `profilePhoto` renders correctly in Notification/Request lists (using new backend logic).
- [ ] Build dedicated Connections screen using `my-connections` API.
