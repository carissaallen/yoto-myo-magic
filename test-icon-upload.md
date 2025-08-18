# Icon Upload Fix Summary

## Problem
The icon upload was not working correctly for the Import button functionality. Icons were being uploaded but not properly associated with tracks in the created playlist.

## Root Causes
1. The `uploadIcon` function was returning `yoto:#mediaId` format instead of the `displayIconId`
2. The `createPlaylistContent` function was using the wrong icon format for tracks
3. There were duplicate function definitions causing confusion

## Solution

### 1. Fixed uploadIcon function (line 811)
```javascript
// Now returns displayIconId for use in tracks
return {
    success: true,
    iconId: response.displayIcon.displayIconId, // Use displayIconId for tracks
    mediaId: response.displayIcon.mediaId,
    displayIconId: response.displayIcon.displayIconId,
    isNew: response.displayIcon.new || false
};
```

### 2. Updated createPlaylistContent function (line 878)
```javascript
// Use displayIconId for tracks, not the yoto:# format
const displayIconId = iconIds[index] || null;

// Only add display icon if we have a valid displayIconId
if (displayIconId) {
    chapter.display = {
        icon16x16: displayIconId
    };
    chapter.tracks[0].display = {
        icon16x16: displayIconId
    };
}
```

### 3. Icon Upload Flow
1. User selects folder with `images/01.png`, `images/02.png`, etc.
2. Each icon is uploaded via `/media/displayIcons/user/me/upload?autoConvert=true`
3. Response contains `displayIconId` (e.g., "683736c62fd7c5cd177d206f")
4. The `displayIconId` is stored at the correct index based on filename
5. When creating playlist, each track gets its corresponding `displayIconId`

## Expected API Response Format

### Icon Upload Response
```json
{
  "displayIcon": {
    "mediaId": "XBkuY6DBFn5iRfFS6nV6CTWaCrEvBOOX8nzV9Y64h8I",
    "userId": "auth0|userHash",
    "displayIconId": "683736c62fd7c5cd177d206f",
    "url": "https://media-secure.aws.com/icons/mlWc6s-JG",
    "new": true
  }
}
```

### Content Creation Request (with icons)
```json
{
  "title": "My Playlist",
  "content": {
    "chapters": [
      {
        "key": "01",
        "title": "Track 1",
        "overlayLabel": "1",
        "display": {
          "icon16x16": "683736c62fd7c5cd177d206f"  // displayIconId, not yoto:# format
        },
        "tracks": [
          {
            "key": "01",
            "title": "Track 1",
            "trackUrl": "yoto:#audioSha256",
            "display": {
              "icon16x16": "683736c62fd7c5cd177d206f"  // displayIconId here too
            }
          }
        ]
      }
    ]
  }
}
```

## Testing
To test the fix:
1. Create a test folder with:
   - `audio_files/track1.mp3`, `audio_files/track2.mp3`
   - `images/01.png` (16x16 icon for track 1)
   - `images/02.png` (16x16 icon for track 2)
2. Click "Import Playlist" button
3. Select the folder
4. Icons should upload and be associated with the correct tracks
5. The created playlist should show custom icons for each track