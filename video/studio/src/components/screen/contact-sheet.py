"""Assemble the three rendered mid-zoom frames; no scene pixels are altered."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

frames = (48, 54, 59)
source = Path("out/v5-review")
paper = Image.open(source / "zoom-48.png").getpixel((0, 0))
sheet = Image.new("RGB", (1920, 900), paper)
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=26)
ink = (26, 29, 33)
draw.text((24, 16), "Mid-zoom proof: the leader endpoint stays on the grey ghost", font=font, fill=ink)
for column, frame in enumerate(frames):
    image = Image.open(source / f"zoom-{frame}.png").convert("RGB")
    x = column * 640
    draw.text((x + 24, 64), f"Session frame {frame}", font=font, fill=ink)
    sheet.paste(image.resize((640, 360), Image.Resampling.LANCZOS), (x, 104))
    draw.text((x + 24, 488), "Endpoint detail (original pixels)", font=font, fill=ink)
    sheet.paste(image.crop((480, 150, 1120, 510)), (x, 528))
sheet.save("evidence/V5/session-zoom-proof.png")
