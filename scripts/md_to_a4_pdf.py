#!/usr/bin/env python3
"""Convert a small, structured Markdown document to a polished A4 PDF."""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\[([^]]+)\]\(([^)]+)\)", r'<link href="\2" color="#1769aa">\1</link>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', text)
    return text


def parse_markdown(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip() or line.strip() == "---":
            i += 1
            continue
        if line.startswith("# ") or line.startswith("## ") or line.startswith("### "):
            level = len(line) - len(line.lstrip("#"))
            out.append(("h" + str(level), line[level + 1 :].strip()))
            i += 1
            continue
        if line.startswith("> "):
            quote = []
            while i < len(lines) and (lines[i].startswith("> ") or not lines[i].strip()):
                if lines[i].startswith("> "):
                    quote.append(lines[i][2:])
                i += 1
            out.append(("quote", " ".join(quote)))
            continue
        if line.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            out.append(("code", "\n".join(code)))
            continue
        if line.startswith("| "):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(set(c) <= set("-: ") for c in cells):
                    rows.append(cells)
                i += 1
            out.append(("table", rows))
            continue
        if re.match(r"^[-*] ", line) or re.match(r"^\d+\. ", line):
            items = []
            ordered = bool(re.match(r"^\d+\. ", line))
            while i < len(lines):
                m = re.match(r"^(?:[-*]|\d+\.)\s+(.*)$", lines[i])
                if not m:
                    break
                items.append(m.group(1))
                i += 1
            out.append(("ol" if ordered else "ul", items))
            continue
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,3} |>|```|\||[-*] |\d+\. )", lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append(("p", " ".join(para)))
    return out


def make_pdf(source: Path, target: Path):
    styles = getSampleStyleSheet()
    title = ParagraphStyle("TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=30, alignment=TA_CENTER, textColor=colors.HexColor("#17324d"), spaceAfter=5 * mm)
    h2 = ParagraphStyle("H2", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=colors.HexColor("#17324d"), spaceBefore=7 * mm, spaceAfter=3 * mm, keepWithNext=True)
    h3 = ParagraphStyle("H3", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=colors.HexColor("#1769aa"), spaceBefore=4 * mm, spaceAfter=2 * mm, keepWithNext=True)
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.6, leading=14.2, textColor=colors.HexColor("#263238"), spaceAfter=2.7 * mm)
    bullet = ParagraphStyle("Bullet", parent=body, leftIndent=5 * mm, firstLineIndent=-3.5 * mm, bulletIndent=0)
    quote = ParagraphStyle("Quote", parent=body, leftIndent=6 * mm, rightIndent=4 * mm, borderPadding=3 * mm, borderColor=colors.HexColor("#d9a441"), borderWidth=0.8, borderLeft=True, textColor=colors.HexColor("#4d5963"), backColor=colors.HexColor("#fffaf0"), spaceBefore=2 * mm, spaceAfter=4 * mm)
    code = ParagraphStyle("Code", parent=body, fontName="Courier", fontSize=7.7, leading=11, leftIndent=4 * mm, rightIndent=4 * mm, backColor=colors.HexColor("#f4f6f8"), borderPadding=3 * mm)
    small = ParagraphStyle("Small", parent=body, fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=colors.HexColor("#607080"))

    doc = SimpleDocTemplate(str(target), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=16 * mm, title=source.stem, author="Jiucaihezi Studio")
    story = []
    first_heading = True
    for kind, value in parse_markdown(source):
        if kind == "h1":
            story.append(Paragraph(inline(value), title if first_heading else h2))
            first_heading = False
        elif kind == "h2":
            story.append(Paragraph(inline(value), h2))
        elif kind == "h3":
            story.append(Paragraph(inline(value), h3))
        elif kind == "p":
            story.append(Paragraph(inline(value), body))
        elif kind == "quote":
            story.append(Paragraph(inline(value), quote))
        elif kind == "code":
            story.append(Paragraph(inline(value).replace("\n", "<br/>"), code))
        elif kind in ("ul", "ol"):
            for n, item in enumerate(value, 1):
                prefix = f"{n}." if kind == "ol" else "•"
                story.append(Paragraph(f"{prefix} {inline(item)}", bullet))
            story.append(Spacer(1, 1 * mm))
        elif kind == "table" and value:
            data = [[Paragraph(inline(c), body) for c in row] for row in value]
            widths = [None] * len(value[0])
            table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17324d")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#c8d0d8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f7f9fb")),
            ]))
            story.append(KeepTogether(table))
            story.append(Spacer(1, 3 * mm))
        if kind == "h2":
            story.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#d9a441"), spaceAfter=2 * mm))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d9a441"))
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, 11 * mm, A4[0] - 18 * mm, 11 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#71808c"))
        canvas.drawString(18 * mm, 6.5 * mm, "Jiucaihezi Studio · Product Introduction")
        canvas.drawRightString(A4[0] - 18 * mm, 6.5 * mm, f"{doc.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: md_to_a4_pdf.py INPUT.md OUTPUT.pdf")
    make_pdf(Path(sys.argv[1]), Path(sys.argv[2]))
