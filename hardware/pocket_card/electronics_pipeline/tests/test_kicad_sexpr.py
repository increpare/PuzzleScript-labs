import dataclasses
import unittest

from hardware.pocket_card.electronics_pipeline.kicad_sexpr import (
    SexprError,
    balanced_block,
    direct_children,
    expression_atoms,
    next_token,
    one_root,
)


class KiCadSexprTest(unittest.TestCase):
    def test_comments_quotes_escapes_duplicates_and_empty_atoms(self):
        source = '(root # hidden (bad)\n (item "a\\\"(b)") (item 2) (empty ""))'
        root = one_root(source, "root")
        children = direct_children(root.text)
        self.assertEqual([child.name for child in children], ["item", "item", "empty"])
        self.assertEqual(expression_atoms(children[0].text, 2), ("item", 'a"(b)'))
        self.assertEqual(expression_atoms(children[2].text, 2), ("empty", ""))

    def test_token_offsets_and_frozen_value_object(self):
        token = next_token("  # note\r\n (root)")
        self.assertEqual((token.kind, token.value, token.start, token.end), ("open", None, 11, 12))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            token.start = 0

    def test_ordinary_octal_and_hex_byte_escapes_decode_as_utf8(self):
        expression = r'(value "line\n\303\251:\xE2\x82\xAC:\\:\q")'
        self.assertEqual(
            expression_atoms(expression, 2),
            ("value", "line\né:\u20ac:\\:\\q"),
        )

    def test_malformed_utf8_byte_escape_is_rejected_at_quote(self):
        with self.assertRaisesRegex(SexprError, r"invalid UTF-8.*index 7"):
            expression_atoms(r'(value "\xC3")', 2)

    def test_unterminated_quote_is_rejected_with_location(self):
        with self.assertRaisesRegex(SexprError, r"unterminated quoted atom.*index 6"):
            one_root('(root "bad)', "root")

    def test_balanced_block_ignores_parentheses_in_quotes_and_comments(self):
        source = 'xx(root "(") # close )\r\n trailing'
        self.assertEqual(balanced_block(source, 2), '(root "(")')

    def test_balanced_block_rejects_unterminated_expression(self):
        with self.assertRaisesRegex(SexprError, r"unterminated S-expression.*index 0"):
            balanced_block("(root (child)", 0)

    def test_balanced_block_requires_open_at_exact_start(self):
        with self.assertRaisesRegex(SexprError, r"opening parenthesis.*index 0"):
            balanced_block(" (root)", 0)

    def test_one_root_rejects_second_root(self):
        with self.assertRaisesRegex(SexprError, "trailing content"):
            one_root("(root)(root)", "root")

    def test_one_root_rejects_trailing_atom(self):
        with self.assertRaisesRegex(SexprError, r"trailing content.*index 7"):
            one_root("(root) extra", "root")

    def test_one_root_rejects_wrong_and_missing_roots(self):
        with self.assertRaisesRegex(SexprError, "expected exactly one root"):
            one_root("(other)", "root")
        with self.assertRaisesRegex(SexprError, "expected exactly one root"):
            one_root(" # only a comment\r\n", "root")

    def test_direct_children_return_exact_spans(self):
        expression = "(root atom (a 1) # hidden\r\n (b (nested 2)))"
        children = direct_children(expression)
        self.assertEqual([(child.name, child.text) for child in children], [("a", "(a 1)"), ("b", "(b (nested 2))")])
        self.assertEqual(expression[children[0].start : children[0].end], children[0].text)

    def test_stray_close_and_invalid_offsets_are_useful_errors(self):
        with self.assertRaisesRegex(SexprError, "offset"):
            next_token("(root)", -1)
        with self.assertRaisesRegex(SexprError, "opening parenthesis"):
            balanced_block("atom", 0)


if __name__ == "__main__":
    unittest.main()
