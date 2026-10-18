//! CSS colour strings (three.js parses them with regular expressions; this is the same grammar).

pub(super) fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

pub(super) struct Cursor<'a> {
    s: &'a [char],
    i: usize,
}

impl Cursor<'_> {
    pub(super) fn ws(&mut self) {
        while self.i < self.s.len() && is_js_space(self.s[self.i]) {
            self.i += 1;
        }
    }

    pub(super) fn eat(&mut self, c: char) -> bool {
        if self.s.get(self.i) == Some(&c) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    pub(super) fn digit_run(&mut self) -> usize {
        let start = self.i;
        while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
            self.i += 1;
        }
        self.i - start
    }

    pub(super) fn digits(&mut self) -> Option<f64> {
        let start = self.i;
        if self.digit_run() == 0 {
            return None;
        }
        self.s[start..self.i].iter().collect::<String>().parse().ok()
    }

    pub(super) fn number(&mut self) -> Option<f64> {
        let start = self.i;
        let int_digits = self.digit_run();

        if self.s.get(self.i) == Some(&'.') && self.s.get(self.i + 1).is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
            self.digit_run();
        } else if int_digits == 0 {
            return None;
        }

        self.s[start..self.i].iter().collect::<String>().parse().ok()
    }

    pub(super) fn at_end(&self) -> bool {
        self.i == self.s.len()
    }
}

pub(super) fn parse_triplet(components: &[char], integers: bool, percent: [bool; 3]) -> Option<[f64; 3]> {
    let mut c = Cursor { s: components, i: 0 };
    let mut out = [0.0; 3];

    for i in 0..3 {
        c.ws();
        out[i] = if integers { c.digits()? } else { c.number()? };
        if percent[i] && !c.eat('%') {
            return None;
        }
        c.ws();
        if i < 2 && !c.eat(',') {
            return None;
        }
    }

    if c.eat(',') {
        c.ws();
        c.number()?;
        c.ws();
    }

    c.at_end().then_some(out)
}

pub(super) fn match_function(style: &[char]) -> Option<(String, &[char])> {
    let name_len = style.iter().take_while(|c| c.is_ascii_alphanumeric() || **c == '_').count();
    if name_len == 0 || style.get(name_len) != Some(&'(') {
        return None;
    }
    let rest = &style[name_len + 1..];
    let close = rest.iter().position(|c| *c == ')')?;
    Some((style[..name_len].iter().collect(), &rest[..close]))
}
