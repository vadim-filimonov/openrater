"""openrater_deploy — demo deployment overlay for OpenRater.

This package is NOT part of the published OSS core. It composes the
unchanged `openrater` app with two deployment concerns:

  1. Serving the built Rate Lab SPA (static files + client-side-routing
     fallback) so the app + API share one origin.
  2. Deriving operator identity from the Cloudflare Access token, wired
     through the core's `register_operator_resolver` seam.

Keeping these here (rather than in `openrater`) honors VISION Part 8 +
SECURITY.md: the OSS core ships no auth/TLS/secrets; the deployment
layer fills those in.
"""
