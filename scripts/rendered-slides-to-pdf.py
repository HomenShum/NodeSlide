#!/usr/bin/env python3
"""Create an honest rasterized PDF fallback from rendered slide PNGs."""

import argparse
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--evidence-dir",
        help="Optional directory for exact per-page embedded-image evidence extracted from the PDF.",
    )
    args = parser.parse_args()
    source = Path(args.input_dir)
    output = Path(args.out)
    slides = sorted(source.glob("slide-*.png"), key=lambda item: int(item.stem.split("-")[-1]))
    if not slides:
        raise RuntimeError("No rendered slide PNGs were found.")
    images = [Image.open(slide).convert("RGB") for slide in slides]
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        images[0].save(output, "PDF", save_all=True, append_images=images[1:], resolution=144)
        reader = PdfReader(str(output))
        page_count = len(reader.pages)
        if page_count != len(slides):
            raise RuntimeError(
                f"PDF page count mismatch: expected {len(slides)}, received {page_count}."
            )
        if args.evidence_dir:
            evidence_dir = Path(args.evidence_dir)
            evidence_dir.mkdir(parents=True, exist_ok=True)
            for index, page in enumerate(reader.pages, start=1):
                embedded = list(page.images)
                if len(embedded) != 1:
                    raise RuntimeError(
                        f"PDF page {index} must contain exactly one embedded slide image; "
                        f"found {len(embedded)}."
                    )
                image = embedded[0]
                suffix = Path(image.name).suffix.lower()
                if suffix not in {".png", ".jpg", ".jpeg"}:
                    raise RuntimeError(
                        f"PDF page {index} produced unsupported evidence image {image.name}."
                    )
                (evidence_dir / f"slide-{index}{suffix}").write_bytes(image.data)
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    main()
