# Flutter Integration Guide - WeddingZon Backend

This guide details how to integrate a Flutter application with the WeddingZon Node.js/MongoDB backend.

## 1. API Configuration

-   **Base URL**: 
    -   Development: `http://<YOUR_LOCAL_IP>:5000/api` (Use IP, not localhost, for Emulator/Device)
    -   Production: `https://api.weddingzon.com/api` (Example)

### HTTP Client
We recommend using **Dio** for robust interceptor support.

```dart
final dio = Dio(BaseOptions(
  baseUrl: 'http://192.168.1.5:5000/api',
  connectTimeout: Duration(seconds: 10),
));
```

## 2. Authentication Flow

The backend uses **JWT (JSON Web Tokens)**.

1.  **Login/Signup**: Returns a `token` in the JSON response.
2.  **Storage**: Securely store this token using `flutter_secure_storage`.
    ```dart
    await storage.write(key: 'jwt_token', value: token);
    ```
3.  **Interceptor**: Attach the token to *every* authenticated request.
    ```dart
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await storage.read(key: 'jwt_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token'; // Note: Space after Bearer
        }
        return handler.next(options);
      },
    ));
    ```

## 3. Key Endpoints & Data Models

### A. Feed (Infinite Scroll)
-   **Endpoint**: `GET /users/feed`
-   **Params**: `cursor` (Optional ID of the last item seen).
-   **Response**:
    ```json
    {
      "data": [ ...list of 9 users... ],
      "nextCursor": "65a123..."
    }
    ```
-   **Logic**:
    1.  Initial Load: Call without cursor.
    2.  Load More: Call `?cursor={nextCursor}`.
    3.  If `nextCursor` is null, stop loading.

### B. Explore / Search (Complex Filters)
-   **Endpoint**: `GET /users/search`
-   **Query Params**:
    -   `page`, `limit` (Pagination)
    -   `minAge`, `maxAge`
    -   `religion`, `community`
    -   `city`, `state` (Partial matches supported)
    -   `height`
    -   **New**: `property_type` (e.g. "Residential"), `land_component` (e.g. "5 Acres")
-   **Flutter Tip**: Use a `Map<String, dynamic>` to build query parameters and pass it to Dio's `queryParameters`.

### C. Image Upload (Multipart)
The backend uses **AWS S3** for image storage.

-   **Endpoint**: `POST /users/upload-photos`
-   **Format**: `multipart/form-data`
-   **Key**: `photos` (Array of files).
-   **Dio Example**:
    ```dart
    FormData formData = FormData.fromMap({
      "photos": [
        await MultipartFile.fromFile(imagePath1, filename: "img1.webp"),
        await MultipartFile.fromFile(imagePath2, filename: "img2.webp"),
      ],
    });
    await dio.post('/users/upload-photos', data: formData);
    ```

## 4. Image Display & Features

### Restricted Access (Twin-Upload Strategy)
The backend automatically serves different URLs based on the viewer's access rights.

-   **Public/Restricted**: Returns the `url` field, which points to a **Blurred, Low-Res** version on S3.
-   **Allowed/Connected**: Returns the `url` field, which points to the **Clear, Watermarked** version on S3.

**Flutter Logic**:
-   **Zero Logic Required Client-Side**: The backend swaps the URL in the JSON response before sending it to you.
-   Simply use `CachedNetworkImage` with the provided `url`.

```dart
// User model
class Photo {
  final String url; // THIS is what you display. It might be blurry or clear.
  final String? key;
}

// Widget
CachedNetworkImage(
  imageUrl: user.photos[0].url, 
  placeholder: (context, url) => CircularProgressIndicator(),
)
```

## 5. Error Handling
The backend uses standard HTTP codes:
-   `401 Unauthorized`: Token invalid/expired. -> **Redirect to Login**.
-   `400 Bad Request`: Validation error (e.g., File too large). -> **Show SnackBar**.
-   `500 Server Error`: Backend crash. -> **Show generic error**.
