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
                 r"ho gaya", r"ho gya", r"ho gayi", r"pura\b", r"poora", r"khatam", r"hua\b",
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
