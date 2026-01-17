#!/usr/bin/env python3
"""
Hey.com authentication helper using pywebview.
Opens a system webview for Hey.com login and captures session cookies.
"""

import json
import os
import sys
from pathlib import Path

try:
    import webview
except ImportError:
    print("Error: pywebview is required. Install with: pip install pywebview", file=sys.stderr)
    sys.exit(1)


class HeyAuth:
    """Handles Hey.com authentication via webview."""

    def __init__(self):
        self.window = None
        self.authenticated = False
        self.data_dir = Path(__file__).parent.parent / "data"
        self.cookies_path = self.data_dir / "hey-cookies.json"

    def on_loaded(self):
        """Called when page finishes loading."""
        if self.window is None:
            return

        url = self.window.get_current_url()
        if url is None:
            return

        # Check if we've navigated away from sign_in page
        if "app.hey.com" in url and "/sign_in" not in url:
            # Successfully logged in - extract cookies
            try:
                cookies_js = self.window.evaluate_js("document.cookie")
                if cookies_js:
                    self.save_cookies(cookies_js, url)
                    self.authenticated = True
                    self.window.destroy()
            except Exception as e:
                print(f"Error extracting cookies: {e}", file=sys.stderr)

    def save_cookies(self, cookie_string: str, url: str):
        """Parse cookie string and save to JSON file."""
        # Ensure data directory exists
        self.data_dir.mkdir(parents=True, exist_ok=True)

        # Parse cookies from document.cookie format
        cookies = []
        if cookie_string:
            for cookie_pair in cookie_string.split("; "):
                if "=" in cookie_pair:
                    name, value = cookie_pair.split("=", 1)
                    cookies.append({
                        "name": name.strip(),
                        "value": value.strip(),
                        "domain": "app.hey.com",
                        "path": "/",
                    })

        session = {
            "cookies": cookies,
            "lastValidated": int(__import__("time").time() * 1000),
        }

        # Write to file
        with open(self.cookies_path, "w") as f:
            json.dump(session, f, indent=2)

        # Set file permissions to 600 (user read/write only)
        os.chmod(self.cookies_path, 0o600)

        print(f"Saved {len(cookies)} cookies to {self.cookies_path}", file=sys.stderr)

    def run(self):
        """Start the authentication flow."""
        self.window = webview.create_window(
            "Hey.com Login",
            "https://app.hey.com/sign_in",
            width=800,
            height=700,
        )
        self.window.events.loaded += self.on_loaded

        # Start the webview
        webview.start()

        return self.authenticated


def main():
    """Main entry point."""
    auth = HeyAuth()
    success = auth.run()

    if success:
        print("Authentication successful", file=sys.stderr)
        sys.exit(0)
    else:
        print("Authentication cancelled or failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
