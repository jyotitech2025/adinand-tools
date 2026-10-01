"""Tests for categorize.py. Run: python3 -m unittest -v test_categorize"""
import json
import unittest
from pathlib import Path

from categorize import category_for, extension_of

TABLE = json.loads((Path(__file__).parent / "categories.json").read_text(encoding="utf-8"))


class TableShape(unittest.TestCase):
    def test_seven_categories_in_app_order(self):
        self.assertEqual([c["name"] for c in TABLE["categories"]],
                         ["Documents", "Images", "Videos", "Apps", "Audio", "Archives", "Others"])

    def test_folder_name_is_the_english_name(self):
        for c in TABLE["categories"]:
            self.assertEqual(c["folder"], c["name"])

    def test_extension_sets_do_not_overlap(self):
        seen = {}
        for c in TABLE["categories"]:
            for ext in c["extensions"] or []:
                self.assertNotIn(ext, seen, f"{ext} in both {seen.get(ext)} and {c['name']}")
                seen[ext] = c["name"]
        self.assertEqual(len(seen), 27)

    def test_extensions_are_lower_case_without_dots(self):
        for c in TABLE["categories"]:
            for ext in c["extensions"] or []:
                self.assertEqual(ext, ext.lower())
                self.assertNotIn(".", ext)


class EveryCategory(unittest.TestCase):
    def test_every_listed_extension_maps_to_its_category(self):
        for c in TABLE["categories"]:
            for ext in c["extensions"] or []:
                self.assertEqual(category_for(f"file.{ext}"), c["name"], ext)

    def test_one_example_per_category(self):
        cases = {
            "invoice.pdf": "Documents",
            "photo.jpeg": "Images",
            "clip.mkv": "Videos",
            "game.xapk": "Apps",
            "song.m4a": "Audio",
            "bundle.7z": "Archives",
            "book.epub": "Others",
        }
        for name, want in cases.items():
            self.assertEqual(category_for(name), want, name)


class Case(unittest.TestCase):
    def test_upper_and_mixed_case_extensions(self):
        self.assertEqual(category_for("Report.PDF"), "Documents")
        self.assertEqual(category_for("x.XAPK"), "Apps")
        self.assertEqual(category_for("IMG_0001.JpG"), "Images")

    def test_name_case_does_not_matter(self):
        self.assertEqual(category_for("REPORT.pdf"), "Documents")


class NotSorted(unittest.TestCase):
    def test_extensionless(self):
        self.assertIsNone(category_for("README"))
        self.assertIsNone(category_for("Makefile"))

    def test_trailing_dot_has_an_empty_extension(self):
        self.assertEqual(extension_of("notes."), "")
        self.assertIsNone(category_for("notes."))

    def test_dotfiles(self):
        self.assertIsNone(category_for(".nomedia"))
        self.assertIsNone(category_for(".hidden.pdf"))


class Others(unittest.TestCase):
    def test_double_extension_uses_the_last_part(self):
        self.assertEqual(extension_of("archive.tar.gz"), "gz")
        self.assertEqual(category_for("archive.tar.gz"), "Others")
        self.assertEqual(category_for("report.pdf.zip"), "Archives")
        self.assertEqual(category_for("movie.mp4.part"), "Others")

    def test_unknown_extensions(self):
        for name in ["design.psd", "sheet.csv", "page.html", "font.ttf"]:
            self.assertEqual(category_for(name), "Others", name)

    def test_whitespace_is_not_trimmed(self):
        # Like the app: "pdf " is not "pdf".
        self.assertEqual(category_for("a.pdf "), "Others")


if __name__ == "__main__":
    unittest.main()
