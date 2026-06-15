#!/usr/bin/env python3
"""
Hey.com authentication helper using pywebview.
Opens a system webview for Hey.com login and captures session cookies.
"""

import json
import os
import sys
import threading
import time
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
        self._extraction_started = False
        self._lock = threading.Lock()

    def on_loaded(self):
        """Called when page finishes loading."""
        if self.window is None or self.authenticated:
            return

        url = self.window.get_current_url()
        if url is None:
            return

        print(f"Page loaded: {url}", file=sys.stderr)

        skip_pages = ["/sign_in", "/two_factor_authentication", "/session", "/verify", "/password"]
        if any(page in url for page in skip_pages):
            print("Waiting for authentication to complete...", file=sys.stderr)
            return

        authenticated_pages = ["/imbox", "/feedbox", "/paper_trail", "/set_aside", "/reply_later", "/clearances"]
        is_authenticated_page = any(page in url for page in authenticated_pages) or (
            "app.hey.com" in url and not any(page in url for page in skip_pages)
        )

        if is_authenticated_page:
            with self._lock:
                if self._extraction_started:
                    return
                self._extraction_started = True
            print("Authenticated page detected, extracting cookies...", file=sys.stderr)
            # Run extraction off the UI thread: get_cookies() blocks on a
            # semaphore whose handler runs on the main thread, so calling it
            # on the main thread deadlocks.
            threading.Thread(target=self._extract_cookies, daemon=True).start()

    def _extract_cookies(self):
        """Extract cookies on a background thread, best method first."""
        # 1. pywebview native API - returns HttpOnly cookies too.
        try:
            print("Extracting cookies via get_cookies()...", file=sys.stderr)
            raw = self.window.get_cookies()
            cookies_list = []
            for simple_cookie in raw or []:
                for name, morsel in simple_cookie.items():
                    domain = morsel["domain"] or "app.hey.com"
                    if "hey.com" not in domain:
                        continue
                    cookies_list.append({
                        "name": name,
                        "value": morsel.value,
                        "domain": domain,
                        "path": morsel["path"] or "/",
                    })
            if cookies_list:
                self._save_cookies_from_list(cookies_list)
                self._finish()
                return
            print("get_cookies() returned no Hey.com cookies", file=sys.stderr)
        except Exception as e:
            print(f"get_cookies() failed: {e}", file=sys.stderr)

        # 2. document.cookie - non-HttpOnly only, often blocked by CSP.
        try:
            cookies_js = self.window.evaluate_js("document.cookie")
            if cookies_js:
                print(f"Got {len(cookies_js)} chars from document.cookie", file=sys.stderr)
                self.save_cookies(cookies_js, "")
                self._finish()
                return
        except Exception as e:
            print(f"JS cookie extraction failed: {e}", file=sys.stderr)

        # 3. Shared system cookie store - last resort.
        self._try_shared_cookie_storage()

    def _finish(self):
        """Mark success and close the window."""
        self.authenticated = True
        if self.window:
            self.window.destroy()

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
                self._finish()
            else:
                print("No Hey.com cookies found in shared storage either", file=sys.stderr)

        except Exception as e:
            print(f"Shared cookie storage failed: {e}", file=sys.stderr)

    def _save_cookies_from_list(self, cookies: list):
        """Save cookies from a list of cookie dicts."""
        self.data_dir.mkdir(parents=True, exist_ok=True)

        session = {
            "cookies": cookies,
            "lastValidated": int(time.time() * 1000),
        }

        tmp_path = self.cookies_path.with_suffix(".tmp")
        with open(tmp_path, "w") as f:
            json.dump(session, f, indent=2)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, self.cookies_path)

        print(f"Saved {len(cookies)} cookies to {self.cookies_path}", file=sys.stderr)

    def save_cookies(self, cookie_string: str, url: str):
        """Parse a document.cookie string and save to JSON file."""
        self.data_dir.mkdir(parents=True, exist_ok=True)

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
            "lastValidated": int(time.time() * 1000),
        }

        tmp_path = self.cookies_path.with_suffix(".tmp")
        with open(tmp_path, "w") as f:
            json.dump(session, f, indent=2)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, self.cookies_path)

        print(f"Saved {len(cookies)} cookies to {self.cookies_path}", file=sys.stderr)

    def _poll_for_auth(self):
        """Poll for authentication completion as a fallback."""
        while not self.authenticated and self.window is not None:
            time.sleep(1)
            try:
                if self.window is None:
                    break
                url = self.window.get_current_url()
                if url:
                    skip_pages = ["/sign_in", "/two_factor_authentication", "/session", "/verify", "/password"]
                    authenticated_pages = ["/imbox", "/feedbox", "/paper_trail", "/set_aside"]

                    if any(page in url for page in authenticated_pages):
                        print(f"Polling detected authenticated page: {url}", file=sys.stderr)
                        self.on_loaded()
                        break
                    elif "app.hey.com" in url and not any(page in url for page in skip_pages):
                        print(f"Polling detected app page: {url}", file=sys.stderr)
                        self.on_loaded()
                        break
            except Exception as e:
                print(f"Polling error: {e}", file=sys.stderr)
                break

    def run(self):
        """Start the authentication flow."""
        self.window = webview.create_window(
            "Hey.com Login",
            "https://app.hey.com/sign_in",
            width=800,
            height=700,
        )
        self.window.events.loaded += self.on_loaded

        poll_thread = threading.Thread(target=self._poll_for_auth, daemon=True)
        poll_thread.start()

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
