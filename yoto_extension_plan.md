# Yoto MYO Browser Extension - Implementation Plan

This document outlines the steps for implementing a browser extension that:
- Imports audio files into a Yoto Make Your Own (MYO) playlist
- Associates track icons with each audio file
- Optionally applies a cover image to the playlist

---

## 📂 Expected Input Folder Structure

```
my_playlist_folder/
│
├── audio_files/
│   ├── 01.m4a
│   ├── 02.mp3
│   ├── 03.m4a
│   └── ...
│
└── images/
    ├── 01.png
    ├── 02.png
    ├── 03.jpg
    ├── cover.png   ← Cover image (non-numeric filename)
    └── ...
```

- **Audio files**: Supported formats include `.m4a`, `.mp3`, `.wav` (Yoto API accepts common formats directly).
- **Track icons**: PNG or JPG files named with **numeric order** (e.g., `01.png`, `02.png`).
- **Cover image**: Optional image with an **alphabetic filename** (e.g., `cover.png`, `album_art.jpg`).

---

## 🔑 High-Level Flow

1. **Authenticate User**
   - Use OAuth2 browser flow to get an access token from Yoto.
   - Store the token securely in extension storage.

2. **Create Playlist & Upload Audio**
   - Iterate over audio files in `audio_files/`.
   - For each file:
     - Call `POST /v1/content` (create content).
     - Capture the `trackId` and playlist `contentId`.
   - Result: Playlist with all audio tracks created in order.

3. **Upload & Map Icons**
   - Iterate over image files in `images/`.
   - Identify:
     - Numeric files → track icons
     - Non-numeric file → cover image
   - For each track icon:
     - Upload icon via `POST /v1/icons`.
     - Get the returned `yoto:icon:*` ID.
     - Map `01.png → Track 1`, `02.png → Track 2`, etc.

4. **Update Playlist with Track Icons**
   - Call `GET /v1/content/{contentId}` to fetch current playlist schema.
   - Update each track’s `"icon"` field with the mapped `yoto:icon:id`.
   - Call `PUT /v1/content/{contentId}` to save updates.

5. **Apply Cover Image**
   - If a cover image is present:
     - Upload via `POST /v1/icons` (cover images use the same endpoint).
     - Set the playlist `"coverIcon"` (or equivalent field in schema) to the uploaded icon’s `yoto:icon:id`.
   - Call `PUT /v1/content/{contentId}` again to apply.

---

## 📜 Detailed Steps

### 1. Authentication
- Use `https://yoto.dev/authentication/auth/` (OAuth2 browser flow).
- Save access token for subsequent API calls.

### 2. Create Playlist & Upload Audio
```http
POST /v1/content
{
  "title": "My Imported Playlist",
  "tracks": [
    {
      "title": "Track 1",
      "file": <binary audio file>
    }
  ]
}
```

- Repeat for each audio file.
- Capture `contentId` from the response.

### 3. Upload Icons
```http
POST /v1/icons
Content-Type: multipart/form-data
(file: <binary image>)
```

- Returns:
```json
{
  "id": "yoto:icon:12345",
  "url": "https://..."
}
```

- Maintain mapping:
  - `01.png → yoto:icon:12345`
  - `02.png → yoto:icon:67890`

### 4. Update Playlist with Icons
```http
PUT /v1/content/{contentId}
{
  "tracks": [
    {
      "id": "yoto:track:aaaa",
      "title": "Track 1",
      "icon": "yoto:icon:12345"
    },
    {
      "id": "yoto:track:bbbb",
      "title": "Track 2",
      "icon": "yoto:icon:67890"
    }
  ]
}
```

### 5. Update Cover Image
- Upload cover via `POST /v1/icons`.
- Update playlist schema:
```http
PUT /v1/content/{contentId}
{
  "coverIcon": "yoto:icon:cover12345"
}
```

---

## 🚀 Extension Implementation Notes

- **File Mapping Logic**:
  - Parse filenames.
  - `^\d+` → Track icon
  - Non-numeric → Cover image
- **Resilience**:
  - Always `POST /v1/icons` even for duplicates (API deduplicates, returns existing ID).
- **Error Handling**:
  - If an audio or image upload fails, report error but continue with remaining files.
- **User Feedback**:
  - Progress bar / logs inside extension popup.

---

## ✅ Acceptance Criteria

- User can select a folder with audio and images.
- Playlist is created with correct audio tracks.
- Each track is assigned the correct custom icon.
- Cover image is updated if provided.
- Duplicate icons do not cause errors.

---

## 🧩 Pseudo-code for Extension

```typescript
async function importPlaylist(folderPath: string) {
  const token = await authenticateWithYoto();

  // 1. Collect files
  const audioFiles = getFiles(folderPath + "/audio_files");
  const imageFiles = getFiles(folderPath + "/images");

  // 2. Create Playlist & Upload Audio
  let playlist = await createPlaylist(token, "My Imported Playlist");
  for (const file of audioFiles) {
    const track = await uploadAudioToContent(token, playlist.id, file);
    playlist.tracks.push(track);
  }

  // 3. Upload Icons
  const trackIcons: Record<string, string> = {};
  let coverIconId: string | null = null;

  for (const img of imageFiles) {
    const iconId = await uploadIcon(token, img);
    if (isNumericFilename(img.name)) {
      const trackNumber = parseInt(img.name.split(".")[0], 10);
      trackIcons[trackNumber] = iconId;
    } else {
      coverIconId = iconId;
    }
  }

  // 4. Update Playlist with Track Icons
  for (let i = 0; i < playlist.tracks.length; i++) {
    playlist.tracks[i].icon = trackIcons[i + 1];
  }
  await updatePlaylist(token, playlist);

  // 5. Apply Cover Image
  if (coverIconId) {
    playlist.coverIcon = coverIconId;
    await updatePlaylist(token, playlist);
  }
}
```
