import os
import sys
from PIL import Image, ImageDraw

def generate_icons(source_image_path='public/app-icon.png'):
    if not os.path.exists(source_image_path):
        print(f"Error: {source_image_path} does not exist")
        sys.exit(1)

    im = Image.open(source_image_path).convert('RGBA')

    # Save to public directory
    public_dir = os.path.abspath('public')
    os.makedirs(public_dir, exist_ok=True)

    im.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'app-icon.png'))
    im.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'apple-touch-icon.png'))
    im.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'app-touch-icon.png'))
    im.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'favicon.png'))
    im.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(public_dir, 'favicon-32x32.png'))
    print("Saved public web icons.")

    # Android mipmaps
    res_dir = os.path.abspath('android/app/src/main/res')
    densities = [
        ('mipmap-mdpi', 48, 108),
        ('mipmap-hdpi', 72, 162),
        ('mipmap-xhdpi', 96, 216),
        ('mipmap-xxhdpi', 144, 324),
        ('mipmap-xxxhdpi', 192, 432),
    ]

    # Pre-render a solid white background version of the icon for adaptive layers
    # so that the outer transparent squircle corners don't show ghost borders on Android adaptive icons
    full_white = Image.new('RGBA', im.size, (255, 255, 255, 255))
    full_white.paste(im, (0, 0), im)

    for folder, icon_size, fg_size in densities:
        target_folder = os.path.join(res_dir, folder)
        os.makedirs(target_folder, exist_ok=True)

        # Standard icon (squircle for legacy launchers)
        standard = im.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
        standard.save(os.path.join(target_folder, 'ic_launcher.png'))

        # Round icon with circular mask on white background
        round_icon = Image.new('RGBA', (icon_size, icon_size), (255, 255, 255, 255))
        round_icon.paste(standard, (0, 0), standard)
        mask = Image.new('L', (icon_size, icon_size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, icon_size - 1, icon_size - 1), fill=255)
        round_icon.putalpha(mask)
        round_icon.save(os.path.join(target_folder, 'ic_launcher_round.png'))

        # Foreground for adaptive icon (scaled to fit comfortably inside the 72dp safe zone of the 108dp canvas)
        fg_canvas = Image.new('RGBA', (fg_size, fg_size), (255, 255, 255, 255))
        inner_size = int(fg_size * 0.69)
        inner_icon = full_white.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
        offset = (fg_size - inner_size) // 2
        fg_canvas.paste(inner_icon, (offset, offset))
        fg_canvas.save(os.path.join(target_folder, 'ic_launcher_foreground.png'))

        print(f"Generated {folder}: {icon_size}x{icon_size} and fg {fg_size}x{fg_size}")

    # Update Android adaptive icon background colors to match white icon background
    values_bg_path = os.path.join(res_dir, 'values', 'ic_launcher_background.xml')
    if os.path.exists(values_bg_path):
        with open(values_bg_path, 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')

    drawable_bg_path = os.path.join(res_dir, 'drawable', 'ic_launcher_background.xml')
    if os.path.exists(drawable_bg_path):
        with open(drawable_bg_path, 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n    <path\n        android:fillColor="#FFFFFF"\n        android:pathData="M0,0h108v108h-108z" />\n</vector>\n')

    print("Updated ic_launcher_background.xml to #FFFFFF")

if __name__ == '__main__':
    source = sys.argv[1] if len(sys.argv) > 1 else 'public/app-icon.png'
    generate_icons(source)
