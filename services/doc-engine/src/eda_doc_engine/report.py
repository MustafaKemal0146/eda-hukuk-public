"""`ExportReport.degraded` sayacı (084 İ5, §4).

Özellik adları `@eda/contracts` `EXPORT_DEGRADED_FEATURES` kümesidir; şemada serbest dize
olduğu için üretilmiş modelde sabit yoktur.
"""

from typing import Final

STRIKE: Final = "strike"
HYPERLINK: Final = "hyperlink"
HARD_BREAK_AS_PARAGRAPH: Final = "hard_break_as_paragraph"
LIST_START: Final = "list_start"
KEEP_TOGETHER: Final = "keep_together"
PAGE_NUMBER: Final = "page_number"
FORBIDDEN_CHAR: Final = "forbidden_char"
HYPERLINK_PROTOCOL: Final = "hyperlink_protocol"


class Degraded:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}

    def add(self, feature: str, count: int = 1) -> None:
        if count > 0:
            self._counts[feature] = self._counts.get(feature, 0) + count

    def items(self) -> list[tuple[str, int]]:
        """Ada göre sıralı (deterministik) sıfırdan büyük sayımlar."""
        return sorted(self._counts.items())
