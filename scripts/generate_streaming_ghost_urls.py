#!/usr/bin/env python3
import json
import os

def generate_ghost_urls(github_username="carissaallen", repo_name="yoto-myo-magic", branch="main"):
    """Generate URLs for streaming ghost icons from GitHub."""

    base_url = f"https://raw.githubusercontent.com/{github_username}/{repo_name}/{branch}"

    # Generate URL mappings
    url_mappings = {}

    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            key = f"ghost-{total_segments}-{i}"
            # For now, all use the same animated GIF
            url = f"{base_url}/assets/icons/timer/ghost/ghost_float_fixed.gif"
            url_mappings[key] = url

    return url_mappings

def create_content_script_helper():
    """Create a helper function for the content script."""

    urls = generate_ghost_urls()

    js_code = """
// Ghost streaming icon URLs
const GHOST_STREAMING_URLS = {
"""

    for key, url in urls.items():
        js_code += f'  "{key}": "{url}",\n'

    js_code += """};

function getGhostStreamingUrl(numSegments, trackIndex) {
  const key = `ghost-${numSegments}-${trackIndex}`;
  return GHOST_STREAMING_URLS[key] || null;
}
"""

    return js_code

def main():
    print("Generating streaming URLs for ghost icons...")
    print("=" * 60)

    # Generate the URLs
    urls = generate_ghost_urls()

    # Save as JSON for reference
    with open("ghost_streaming_urls.json", "w") as f:
        json.dump(urls, f, indent=2)

    print(f"Generated {len(urls)} streaming URLs")
    print(f"Saved to ghost_streaming_urls.json")

    # Generate JavaScript helper
    js_code = create_content_script_helper()

    with open("ghost_streaming_helper.js", "w") as f:
        f.write(js_code)

    print(f"Generated ghost_streaming_helper.js")

    # Show example URLs
    print("\nExample URLs:")
    for key in list(urls.keys())[:3]:
        print(f"  {key}: {urls[key]}")

    print("\nTo use streaming icons:")
    print("1. Commit and push the ghost GIFs to GitHub")
    print("2. Include ghost_streaming_helper.js in content script")
    print("3. Use iconUrl16x16 instead of uploading icons")

if __name__ == "__main__":
    main()