import argparse
import numpy as np
from PIL import Image

def generate_fuzzy_icons(input_path, threshold=30):
    print(f"Opening {input_path}...")
    with Image.open(input_path).convert("RGBA") as img:
        
        np_img = np.array(img)
        bg_rgb = np_img[0, 0, :3]
        print(f"Sampled Background RGB: {bg_rgb}")

        rgb_channels = np_img[:, :, :3]
        alpha_channel = np_img[:, :, 3]

        diff = rgb_channels.astype(np.float32) - bg_rgb.astype(np.float32)
        dist_sq = np.sum(np.square(diff), axis=2)
        dist = np.sqrt(dist_sq)

        alpha_channel[dist < threshold] = 0
        alpha_channel[dist >= threshold] = 255

        processed_data = np.dstack((rgb_channels, alpha_channel))
        processed_img = Image.fromarray(processed_data.astype(np.uint8), mode="RGBA")

        width, height = processed_img.size
        crop_size = min(width, height)
        
        left = (width - crop_size) // 2
        top = (height - crop_size) // 2
        right = (width + crop_size) // 2
        bottom = (height + crop_size) // 2
        
        squared_img = processed_img.crop((left, top, right, bottom))

        sizes = [512, 192]
        for size in sizes:
            icon = squared_img.resize((size, size), Image.Resampling.LANCZOS)
            icon.save(f"icon-{size}.png")
            print(f"Saved icon-{size}.png (threshold: {threshold})")

        # Generate multi-resolution favicon.ico
        favicon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
        squared_img.save("favicon.ico", format="ICO", sizes=favicon_sizes)
        print("Saved favicon.ico (bundled sizes: 16, 32, 48, 64)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate square icons with transparent backgrounds.")
    parser.add_argument("image", help="Path to the input image file")
    parser.add_argument("-f", "--fuzz", type=float, default=30, help="Color fuzz threshold (default: 30)")
    
    args = parser.parse_args()
    
    generate_fuzzy_icons(args.image, threshold=args.fuzz)
