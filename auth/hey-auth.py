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
        if self.window is None or self.authenticated:
            return

        url = self.window.get_current_url()
        if url is None:
            return

        print(f"Page loaded: {url}", file=sys.stderr)

        # Skip auth pages - wait until we reach the actual app
        skip_pages = ["/sign_in", "/two_factor_authentication", "/session", "/verify"]
        if any(page in url for page in skip_pages):
            print("Waiting for authentication to complete...", file=sys.stderr)
            return

        # Check if we've navigated to an authenticated page (imbox, feed, etc.)
        if "app.hey.com" in url:
            print("Authenticated page detected, extracting cookies...", file=sys.stderr)

            # Try JavaScript first (works for non-HttpOnly cookies)
            try:
                cookies_js = self.window.evaluate_js("document.cookie")
                if cookies_js:
                    print(f"Got {len(cookies_js)} chars from document.cookie", file=sys.stderr)
                    self.save_cookies(cookies_js, url)
                    self.authenticated = True
                    self.window.destroy()
                    return
            except Exception as e:
                print(f"JS cookie extraction failed: {e}", file=sys.stderr)

            # Fall back to native cookie extraction (gets HttpOnly cookies too)
            self._try_shared_cookie_storage()

    def _try_native_cookie_extraction(self):
        """Fallback: extract cookies using macOS native APIs via pyobjc."""
        try:
            print("Attempting native cookie extraction via pyobjc...", file=sys.stderr)

            # Access the actual WKWebView from pywebview's window
            if self.window is None:
                print("No window available", file=sys.stderr)
                return

            # pywebview stores the native webview in window.webview on macOS
            native_webview = getattr(self.window, '_webview', None)
            if native_webview is None:
                # Try alternate attribute names pywebview might use
                for attr in ['webview', 'browser', '_browser']:
                    native_webview = getattr(self.window, attr, None)
                    if native_webview is not None:
                        break

            if native_webview is None:
                print("Could not access native webview", file=sys.stderr)
                self._try_shared_cookie_storage()
                return

            # Get the WKWebView's configuration and its website data store
            config = native_webview.configuration()
            data_store = config.websiteDataStore()
            http_cookie_store = data_store.httpCookieStore()

            def cookie_handler(cookies):
                cookies_list = []
                for cookie in cookies:
                    domain = str(cookie.domain())
                    if "hey.com" in domain:
                        cookies_list.append({
                            "name": str(cookie.name()),
                            "value": str(cookie.value()),
                            "domain": domain,
                            "path": str(cookie.path()),
                        })

                if cookies_list:
                    self._save_cookies_from_list(cookies_list)
                    self.authenticated = True
                    if self.window:
                        self.window.destroy()
                else:
                    print("No Hey.com cookies found in webview", file=sys.stderr)
                    self._try_shared_cookie_storage()

            http_cookie_store.getAllCookies_(cookie_handler)

        except Exception as e:
            print(f"Native cookie extraction failed: {e}", file=sys.stderr)
            self._try_shared_cookie_storage()

    def _try_shared_cookie_storage(self):
        """Last resort: try NSHTTPCookieStorage (shared system cookies)."""
        try:
            from Foundation import NSHTTPCookieStorage

            print("Trying shared NSHTTPCookieStorage...", file=sys.stderr)
            cookie_storage = NSHTTPCookieStorage.sharedHTTPCookieStorage()
            all_cookies = cookie_storage.cookies()

            cookies_list = []
            for cookie in all_cookies:
                domain = str(cookie.domain())
                if "hey.com" in domain:
                    cookies_list.append({
                        "name": str(cookie.name()),
                        "value": str(cookie.value()),
                        "domain": domain,
                        "path": str(cookie.path()),
                    })

            if cookies_list:
                self._save_cookies_from_list(cookies_list)
                self.authenticated = True
                if self.window:
                    self.window.destroy()
            else:
                print("No Hey.com cookies found in shared storage either", file=sys.stderr)

        except Exception as e:
            print(f"Shared cookie storage failed: {e}", file=sys.stderr)

    def _save_cookies_from_list(self, cookies: list):
        """Save cookies from a list of cookie dicts."""
        self.data_dir.mkdir(parents=True, exist_ok=True)

        session = {
            "cookies": cookies,
            "lastValidated": int(__import__("time").time() * 1000),
        }

        with open(self.cookies_path, "w") as f:
            json.dump(session, f, indent=2)

        os.chmod(self.cookies_path, 0o600)
        print(f"Saved {len(cookies)} cookies to {self.cookies_path}", file=sys.stderr)

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

        # Start webview with private_mode=False to use persistent cookie storage
        # This allows us to access cookies via NSHTTPCookieStorage
        webview.start(private_mode=False)

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
