import pytest

from .mock_api import MockApi


@pytest.fixture(scope="session")
def api():
    server = MockApi()
    yield server
    server.stop()


@pytest.fixture(autouse=True)
def _reset(api):
    api.reset()
    yield
