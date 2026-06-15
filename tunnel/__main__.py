"""Entry point: python -m tunnel"""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


async def main():
    from tunnel.settings import CSettings
    from tunnel.tunnel_worker import TunnelWorker
    settings = CSettings.from_env()
    worker = TunnelWorker(settings)
    await worker.start()


if __name__ == "__main__":
    asyncio.run(main())
