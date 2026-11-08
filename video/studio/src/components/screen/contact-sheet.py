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
    sheet.paste(image.crop((960, 64, 1600, 424)), (x, 528))
sheet.save("evidence/V5/session-zoom-proof.png")

session = Image.new("RGB", (1920, 3360), paper)
draw = ImageDraw.Draw(session)
for row, (name, label) in enumerate((
    ("session-innovation", "Innovation: passive movement fades; memo keeps the goal and your hand"),
    ("session-callouts", "Ghost and solid: the opening goal stays visible"),
    ("session-vision", "Technology: 21 MediaPipe points; hand footage inset above captions"),
)):
    y = row * 1120
    draw.text((24, y + 6), label, font=font, fill=ink)
    session.paste(Image.open(source / f"{name}.png").convert("RGB"), (0, y + 40))
session.save("evidence/V5/session-callouts.png")

doctor = Image.new("RGB", (3840, 2240), paper)
draw = ImageDraw.Draw(doctor)
for index, (name, label) in enumerate((
    ("doctor-history", "History: both hands centered"),
    ("doctor-replay", "Replay: recorded traces held before focusing current"),
    ("doctor-current", "Replay: current spike after the chart hold"),
    ("doctor-summary", "Therapist summary: stored real Gemini output"),
)):
    x, y = (index % 2) * 1920, (index // 2) * 1120
    draw.text((x + 24, y + 6), label, font=font, fill=ink)
    doctor.paste(Image.open(source / f"{name}.png").convert("RGB"), (x, y + 40))
doctor.save("evidence/V5/doctor-review.png")
