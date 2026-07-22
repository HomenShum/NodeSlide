from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
PDF_PATH = OUTPUT / "atlas-v2-evidence-region.pdf"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(PDF_PATH), pagesize=letter, invariant=1)
    width, height = letter
    page.setFillColor(HexColor("#FCFAF5"))
    page.rect(0, 0, width, height, fill=1, stroke=0)

    page.setFillColor(HexColor("#8B2F3C"))
    page.setFont("Helvetica-Bold", 10)
    page.drawString(54, height - 54, "NODESLIDE - EVIDENCE RECEIPT")
    page.setFillColor(HexColor("#232220"))
    page.setFont("Helvetica-Bold", 22)
    page.drawString(54, height - 94, "Semantic inspection must bind to")
    page.drawString(54, height - 122, "source regions")

    page.setFillColor(HexColor("#6D6860"))
    page.setFont("Helvetica", 11)
    page.drawString(54, height - 150, "Artifact Atlas V2 corrective evidence - generated fixture - page 1 of 1")

    body = [
        "A rendered file proves that a file exists. It does not prove that the visual",
        "communicates the right relationship, arithmetic, evidence type, or model result.",
        "NodeSlide therefore records semantic, evidence, accessibility, browser, and",
        "PowerPoint gates independently before an artifact can become eligible.",
    ]
    page.setFillColor(HexColor("#232220"))
    page.setFont("Helvetica", 13)
    y = height - 205
    for line in body:
        page.drawString(70, y, line)
        y -= 22

    region_y = height - 390
    page.setFillColor(HexColor("#F4D9D4"))
    page.roundRect(62, region_y, width - 124, 82, 12, fill=1, stroke=0)
    page.setStrokeColor(HexColor("#8B2F3C"))
    page.setLineWidth(2)
    page.roundRect(62, region_y, width - 124, 82, 12, fill=0, stroke=1)
    page.setFillColor(HexColor("#8B2F3C"))
    page.setFont("Helvetica-Bold", 12)
    page.drawString(82, region_y + 54, "BOUND CLAIM REGION")
    page.setFillColor(HexColor("#232220"))
    page.setFont("Helvetica-Bold", 15)
    page.drawString(82, region_y + 27, "Eligibility requires semantic proof, not screenshot existence.")

    page.setFillColor(HexColor("#315E72"))
    page.setFont("Helvetica-Bold", 11)
    page.drawString(70, 245, "REPRODUCIBLE BINDING")
    page.setFillColor(HexColor("#232220"))
    page.setFont("Courier", 10)
    for index, line in enumerate(
        [
            "mimeType: application/pdf",
            "page: 1",
            "region: x=0.08 y=0.42 width=0.84 height=0.18",
            "claimId: pdf-evidence-region:claim:1",
        ]
    ):
        page.drawString(70, 220 - index * 18, line)

    page.setStrokeColor(HexColor("#D8D1C5"))
    page.line(54, 66, width - 54, 66)
    page.setFillColor(HexColor("#6D6860"))
    page.setFont("Helvetica", 9)
    page.drawString(54, 48, "Generated fixture - no external customer or production claim")
    page.drawRightString(width - 54, 48, "1")
    page.save()
    print(PDF_PATH)


if __name__ == "__main__":
    main()
