with open(".Jules/palette.md", "r") as f:
    text = f.read()
text = text.replace("\\n", "\n")
with open(".Jules/palette.md", "w") as f:
    f.write(text)
