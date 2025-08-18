# Google Analytics 4 Setup Guide

## Configuration Setup

1. **Copy the config template**:
   ```bash
   cp config.template.js config.js
   ```

2. **Edit config.js** with your values:
   - `GA_MEASUREMENT_ID`: Your GA4 Measurement ID
   - `GA_API_SECRET`: Your GA4 API Secret (optional but recommended)
   - `EXTENSION_ID`: Your Chrome extension ID (from Chrome Web Store)

## Setting Up Google Analytics 4 for Yoto MYO Magic

### Step 1: Create a GA4 Property

1. Go to [Google Analytics](https://analytics.google.com)
2. Click on "Admin" (gear icon)
3. Click "Create Property"
4. Enter property name: "Yoto MYO Magic Extension"
5. Select your timezone and currency
6. Click "Next" and fill in business information
7. Click "Create" and accept the terms

### Step 2: Get Your Measurement ID

1. In your new property, go to Admin → Data Streams
2. Click "Add stream" → "Web"
3. Enter:
   - URL: `chrome-extension://YOUR_EXTENSION_ID`
   - Stream name: "Chrome Extension"
4. Click "Create stream"
5. Copy the Measurement ID (format: G-XXXXXXXXXX)

### Step 3: Configure the Extension

1. Open `lib/analytics.js`
2. Replace `G-XXXXXXXXXX` with your actual Measurement ID:
   ```javascript
   const GA_MEASUREMENT_ID = 'G-YOUR_ID_HERE';
   ```

### Step 4: Optional - Enhanced Measurement

For more secure measurement, you can add an API Secret:

1. In GA4, go to Admin → Data Streams → your stream
2. Under "Measurement Protocol API secrets", click "Create"
3. Name it "Chrome Extension" and click "Create"
4. Copy the secret value
5. Add it to `lib/analytics.js`:
   ```javascript
   const GA_API_SECRET = 'YOUR_SECRET_HERE';
   ```

### Step 5: Test Your Implementation

1. Install the extension in Chrome
2. Use the extension features (import, icon matching, etc.)
3. In GA4, go to Reports → Realtime
4. You should see events appearing within a few seconds

## Events Being Tracked

The extension tracks the following events:

- **extension_installed** - When the extension is first installed
- **extension_updated** - When the extension is updated
- **authentication** - When user authenticates with Yoto
- **import_playlist** - When user imports a playlist (ZIP or folder)
  - Parameters: source, file_count, success
- **icon_match** - When icons are matched to tracks
  - Parameters: match_count, automated
- **feature_use** - General feature usage
  - Parameters: feature_name

## Privacy Considerations

- Analytics are anonymized (no PII collected)
- Users can disable analytics in extension settings
- Only usage metrics are tracked, no personal data
- All data is processed according to Google's privacy policies

## Viewing Reports

In GA4, you can view:

1. **Realtime Report** - See activity as it happens
2. **Engagement → Events** - See all events and their counts
3. **User → Tech → Browser** - See Chrome version distribution
4. **Custom Reports** - Create custom reports for specific metrics

## Troubleshooting

If events aren't appearing:

1. Check the Measurement ID is correct
2. Ensure `www.google-analytics.com` is in host_permissions
3. Check browser console for any errors
4. Wait 24-48 hours for full data to appear in standard reports
5. Use Realtime reports for immediate testing