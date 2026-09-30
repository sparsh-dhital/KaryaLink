"""Construction-progress lexicon: English, Hinglish (romanised) and Devanagari.

Patterns are regexes applied to a normalised (lower-cased, typo-corrected,
number-words-to-digits) copy of the text; evidence spans map back to the original.
"""
from __future__ import annotations

# canonical phase -> regex alternatives (order within a list does not matter)
PHASES: dict[str, list[str]] = {
    "excavation": [r"excavat\w*", r"excav\w*", r"\bexc\b", r"digging", r"\bdig\b", r"earthwork",
                   r"khudai", r"khodai", r"खुदाई"],
    "pcc": [r"\bpcc\b", r"lean concrete", r"blinding"],
    "rebar": [r"rebar\w*", r"reinforcement", r"bar bending", r"shuttering", r"formwork", r"sariya", r"सरिया"],
    "pour": [r"\bpour\w*", r"concreting", r"\bcasting\b", r"\bcast\b", r"\brcc\b", r"dhala+i", r"ढलाई",
             r"concrete dal\w*"],
    "backfill": [r"back[\s-]?fill\w*", r"bharai", r"mitti bhar\w*", r"भराई"],
    "fabrication": [r"fabricat\w*", r"\bfab\b", r"spool ban\w*"],
    "erection": [r"erect\w*", r"erctn", r"erecn", r"spool laga\w*"],
    "welding": [r"weld\w*", r"wldg", r"\bjod\b", r"वेल्डिंग"],
    "hydrotest": [r"hydro[\s-]?test\w*", r"pressure test\w*", r"\bht\b", r"hydro\b"],
    "install": [r"install\w*", r"instln", r"instl\b", r"fixing", r"\bfixed\b", r"mount\w*", r"fitting",
                r"\bfit kiya\b", r"laga\s?(?:diya|di|ya|yi|yaa|na)\b", r"लगा"],
    "cable_pull": [r"cable pull\w*", r"pull\w* cable", r"cable lay\w*", r"cabling", r"kheench\w*", r"khinch\w*",
                   r"cables? pulled", r"पुलिंग"],
    "termination": [r"terminat\w*", r"gland\w*"],
    "hookup": [r"impulse tub\w*", r"tubing", r"hook[\s-]?up"],
    "loop_check": [r"loop[\s-]?(?:check\w*|test\w*)", r"\blc\b"],
    "setting": [r"setting", r"placement", r"positioning", r"placed on", r"rakh\s?di\w*", r"\brakh\w*",
                r"set on (?:foundation|fdn)"],
    "alignment": [r"align\w*"],
    "grouting": [r"grout\w*"],
    "barricading": [r"barricad\w*", r"signage"],
    "audit": [r"\baudit\w*"],
}

PHASE_DISCIPLINE = {
    "excavation": "CIV", "pcc": "CIV", "rebar": "CIV", "pour": "CIV", "backfill": "CIV",
    "fabrication": "PIP", "erection": "PIP", "welding": "PIP", "hydrotest": "PIP",
    "cable_pull": "ELE", "termination": "ELE",
    "hookup": "INS", "loop_check": "INS",
    "setting": "MEC", "alignment": "MEC", "grouting": "MEC",
    "barricading": "HSE", "audit": "HSE",
    "install": None,  # ambiguous: tray (ELE), instrument (INS), hydrant/shower (HSE)
}

PHASE_LABEL = {
    "excavation": "Excavation", "pcc": "PCC", "rebar": "Rebar & formwork", "pour": "Concrete pour",
    "backfill": "Backfilling", "fabrication": "Fabrication", "erection": "Erection", "welding": "Welding",
    "hydrotest": "Hydrotest", "install": "Installation", "cable_pull": "Cable pulling",
    "termination": "Termination", "hookup": "Hook-up", "loop_check": "Loop check", "setting": "Setting",
    "alignment": "Alignment", "grouting": "Grouting", "barricading": "Barricading", "audit": "Audit",
}

STATUSES: dict[str, list[str]] = {
    "start": [r"\bstart\w*", r"\bstrtd\b", r"commenc\w*", r"\bbegun\b", r"\bbegan\b", r"kicked off",
              r"shuru(?: ho gaya| kiya| hua| ho gya)?", r"chalu kiya", r"mobili[sz]ed", r"शुरू"],
    "progress": [r"in[\s-]?progress", r"ongoing", r"progressing", r"\bwip\b", r"continu\w*",
                 r"chal (?:raha|rahi|rhi|rha)(?: hai| he)?", r"jaari", r"chalu hai", r"ho raha hai",
                 r"जारी", r"चल रहा"],
    "complete": [r"complet\w*", r"\bcompl\b", r"\bcmpltd\b", r"\bdone\b", r"finish\w*", r"\bover\b",
                 r"ho gaya", r"ho gya", r"ho gayi", r"ho gaye", r"ho gae", r"pura\b", r"poora", r"khatam", r"hua\b",
                 r"पूरा", r"हो गया", r"समाप्त", r"\b(?:kar|laga|rakh|bichha|dal) (?:diya|di|diye)\b",
                 r"\bdiya\b", r"\bdiye\b"],
}

# Tokens that suggest a discipline even without a phase word
DISCIPLINE_CUES: dict[str, list[str]] = {
    "CIV": [r"foundation", r"\bfdn\b", r"\bfndn\b", r"concrete", r"\bconc\b", r"cum\b", r"\bm3\b"],
    "PIP": [r"spools?\b", r"joints?\b", r"\bline\b", r"\bln\b", r"pipe"],
    "ELE": [r"cable", r"tray", r"\bdb\b", r"megger"],
    "INS": [r"transmitter", r"instrument", r"gauge", r"impulse"],
    "MEC": [r"pump", r"vessel", r"compressor", r"cooler", r"tank", r"drum", r"separator", r"skid"],
    "HSE": [r"hydrant", r"shower", r"safety", r"signboard", r"extinguisher", r"assembly point", r"\bhse\b"],
}

NEW_WORK_CUES = [r"\bextra\b", r"additional", r"\baddl\b", r"\bnaya\b", r"\bnayi\b", r"\bnew\b", r"temporary",
                 r"\btemp\b", r"rework", r"not in (?:the )?plan", r"drawing me nahi", r"\bspare\b",
                 r"\brepair\b", r"re-?weld"]

UNITS = {
    r"cum\b|m3\b|cu\.?\s?m\b|cubic m\w*": "m3",
    r"mt\b|tons?\b|tonnes?\b": "MT",
    r"rmt\b|mtrs?\b|meters?\b|metres?\b|m\b": "m",
    r"spools?\b|nos spools\b": "spools",
    r"joints?\b|jts\b": "joints",
    r"nos\b|no\.|numbers?\b": "nos",
    r"loops?\b": "loop",
}

NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
    # Hindi (romanised). "do" is deliberately excluded (too ambiguous with English "do").
    "ek": 1, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "che": 6, "saat": 7,
    "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "bees": 20, "pachas": 50,
}

# Vocabulary used for typo correction (fuzzy match of long tokens).
CORRECTION_VOCAB = [
    "excavation", "foundation", "reinforcement", "shuttering", "formwork", "concrete", "concreting",
    "casting", "backfilling", "fabrication", "erection", "erected", "welding", "welded", "hydrotest",
    "installation", "installed", "pulling", "termination", "terminated", "tubing", "alignment", "grouting",
    "barricading", "completed", "complete", "finished", "started", "commenced", "progress", "progressing",
    "ongoing", "continuing", "yesterday", "transmitter", "setting", "positioning", "placement", "khudai",
    "dhalai", "bharai", "mounting", "fixing", "fitting", "glanding", "signage", "pressure", "spools",
    "joints", "hookup", "impulse", "checking", "cabling", "install", "erect", "installing",
    "welded", "shuttering", "grouted", "aligned",
]

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


# ---------------------------------------------------------------------------------------------
# Speech-to-text normalisation. Browser hi-IN recognition returns Devanagari, and spells tag
# letters out ("एफ 12" = F-12, "सी टी बी 07" = CT-B-07). These maps transliterate tokens so the
# same rules apply; evidence spans still point at the original Devanagari text.

# Spoken letter names -> latin letter (used only when followed by a digit / another letter / dash,
# because some double as Hindi words: "के" = "of", "जी" = "ji").
DEVA_LETTERS = {
    "ए": "a", "बी": "b", "सी": "c", "डी": "d", "ई": "e", "एफ": "f", "जी": "g", "एच": "h", "आई": "i",
    "जे": "j", "के": "k", "एल": "l", "एम": "m", "एन": "n", "ओ": "o", "पी": "p", "क्यू": "q", "आर": "r",
    "एस": "s", "टी": "t", "यू": "u", "वी": "v", "डब्ल्यू": "w", "डबल्यू": "w", "एक्स": "x", "वाई": "y",
    "जेड": "z", "ज़ेड": "z",
    # common letter pairs recognisers emit as one token
    "पीटी": "pt", "एफटी": "ft", "एलटी": "lt", "टीटी": "tt", "पीजी": "pg", "सीटी": "ct", "एसएस": "ss",
}
DEVA_WORDS = {
    "लाइन": "line", "लाईन": "line", "फाउंडेशन": "foundation", "फाउंडेशन्स": "foundation", "स्पूल": "spool",
    "स्पूल्स": "spools", "केबल": "cable", "ट्रे": "tray", "वेल्डिंग": "welding", "वेल्ड": "weld",
    "जॉइंट": "joint", "जोइंट": "joint", "जॉइंट्स": "joints", "इरेक्शन": "erection", "फैब्रिकेशन": "fabrication",
    "फेब्रिकेशन": "fabrication", "हाइड्रोटेस्ट": "hydrotest", "हाइड्रो": "hydro", "टेस्ट": "test", "प्रेशर": "pressure",
    "पुलिंग": "pulling", "टर्मिनेशन": "termination", "इंस्टॉलेशन": "installation", "इंस्टालेशन": "installation",
    "इंस्टॉल": "install", "अलाइनमेंट": "alignment", "ग्राउटिंग": "grouting", "बैकफिल": "backfill",
    "बैकफिलिंग": "backfilling", "कंक्रीट": "concrete", "कंक्रीटिंग": "concreting", "पोरिंग": "pouring",
    "कास्टिंग": "casting", "शटरिंग": "shuttering", "पंप": "pump", "टैंक": "tank", "कंप्रेसर": "compressor",
    "वेसल": "vessel", "मीटर": "meter", "क्यूबिक": "cubic", "टन": "ton", "नग": "nos", "प्रतिशत": "percent",
    "परसेंट": "percent", "यूनिट": "unit", "एरिया": "area", "में": "me", "मे": "me", "से": "se", "हो": "ho",
    "गया": "gaya", "गए": "gaye", "गई": "gayi", "गयी": "gayi", "शुरू": "shuru", "पूरा": "pura", "पूरी": "puri",
    "चल": "chal", "रहा": "raha", "रही": "rahi", "है": "hai", "आज": "aaj", "कल": "kal", "परसों": "parso",
    "का": "ka", "की": "ki", "के": "ke", "और": "aur", "जी": "ji", "डन": "done", "कंप्लीट": "complete",
    "कम्पलीट": "complete", "स्टार्ट": "start", "स्टार्टेड": "started", "प्रोग्रेस": "progress", "लूप": "loop",
    "चेक": "check", "ट्यूबिंग": "tubing", "हुकअप": "hookup", "सेटिंग": "setting", "बैरिकेडिंग": "barricading",
    "ऑडिट": "audit", "हाइड्रेंट": "hydrant", "शावर": "shower", "सेफ्टी": "safety", "इंस्ट्रूमेंट": "instrument",
    "ट्रांसमीटर": "transmitter", "डैश": "-", "हाइफ़न": "-", "हाइफन": "-", "इंच": "inch", "स्टेटस": "status",
    "क्या": "kya", "कितना": "kitna", "कितनी": "kitni", "बताओ": "batao", "बताइए": "bataiye", "लगा": "laga",
    "दिया": "diya", "दिए": "diye", "खत्म": "khatam", "ख़त्म": "khatam", "जारी": "jaari", "अतिरिक्त": "extra",
    "नया": "naya", "नई": "nayi", "एक्स्ट्रा": "extra",
}
DEVA_NUMBERS = {
    "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "छे": 6,
    "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20, "पच्चीस": 25, "तीस": 30, "चालीस": 40,
    "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90, "सौ": 100,
}
DEVA_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
SPOKEN_PUNCT = {"dash": "-", "hyphen": "-", "minus": "-"}
