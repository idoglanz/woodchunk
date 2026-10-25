"""Settings parsed from the environment."""

from app.config import Settings


def test_frontend_origins_accepts_several_addresses():
    s = Settings(frontend_url="https://frontend-production-bae4.up.railway.app, https://woodchunk.zizitripo.com/")
    assert s.frontend_origins == {"https://frontend-production-bae4.up.railway.app", "https://woodchunk.zizitripo.com"}


def test_frontend_origins_adds_https_for_http():
    assert Settings(frontend_url="http://example.test").frontend_origins == {"http://example.test", "https://example.test"}
