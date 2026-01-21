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
-   **Architecture**:
    -   Do **NOT** mix connections with Invites/Notifications.
    -   Create a separate screen/tab for "My Connections".
    -   The "Activity" screen should only show "Invites" (`/api/connections/requests`) and "Notifications" (`/api/connections/notifications`).
    -   Link to this Connections screen from the User Profile ("Connections" button) or a side drawer.
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
    -   **Important**: Implement Client-Side Deduplication to ensure no user appears twice (safety for backend edge cases).

    **Dart Example for Deduplication:**
    ```dart
    final seenIds = <String>{};
    final uniqueList = rawResponseList.where((u) => seenIds.add(u['_id'])).toList();
    ```

## 6. Sequential Image Upload Logic (Robust Queue)

To prevent `413 Payload Too Large` errors and Network Timeouts when uploading multiple high-res images, you **MUST** implement a frontend queue. Do NOT send 10 images in a single API call if they are large.

**Strategy:**
1.  **Selection**: User selects multiple images.
2.  **Validation**: Client-side check (Type: Image, Size: <50MB each).
3.  **Queueing**: Add Valid images to a local list as "Temporary" objects with `status: 'pending'`.
4.  **Optimistic UI**: Display the image immediately using a local File Image provider.
5.  **Sequential Execution**:
    -   Watch the list. Find the first `pending` item.
    -   Set status `uploading` (Show Spinner).
    -   Call `POST /api/users/upload-photos` with **ONE** file in `FormData`.
    -   **Wait** for response.
    -   **Success**: Update item with backend URL/ID. Status `success`.
    -   **Failure**: Update item with Error Message. Status `error`. Do NOT block the next item.
    -   Repeat for next `pending` item.

**Dart/Flutter Pseudocode (Store/Provider Logic):**

```dart
class PhotoUploadStore {
  ObservableList<PhotoItem> photos = ObservableList();

  void addFiles(List<File> newFiles) {
    for (var file in newFiles) {
      if (!isValid(file)) continue;
      photos.add(PhotoItem(file: file, status: UploadStatus.pending));
    }
    _processQueue();
  }

  Future<void> _processQueue() async {
    // Find next pending
    var nextItem = photos.firstWhereOrNull((p) => p.status == UploadStatus.pending);
    if (nextItem == null) return; // All done

    nextItem.status = UploadStatus.uploading;
    notifyListeners();

    try {
      final response = await api.uploadPhoto(nextItem.file); // Single upload
      if (response.success) {
        nextItem.updateFromBackend(response.data[0]); 
        nextItem.status = UploadStatus.success;
      } else {
        nextItem.error = response.message;
        nextItem.status = UploadStatus.error;
      }
    } catch (e) {
      nextItem.error = "Network Error";
      nextItem.status = UploadStatus.error;
    }
    
    notifyListeners();
    // Recursively process next
    _processQueue(); 
  }
}
```

**Why?**
-   Ensures robustness on slow mobile networks.
-   Prevents server rejections for total body size.
-   Gives granular feedback (e.g., "Image 3 failed, others worked").
