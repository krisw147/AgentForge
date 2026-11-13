from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Set

from sqlalchemy.orm import Session

from ..models import KnowledgeDoc


@dataclass(frozen=True)
class RetrievedDocument:
    id: str
    title: str
    source: str
    content: str
    score: float


def _tokens(text: str) -> Set[str]:
    normalized = re.sub(r"\s+", "", text.lower())
    latin = set(re.findall(r"[a-z0-9_-]{2,}", normalized))
    chinese = normalized.replace(" ", "")
    grams = {
        chinese[index : index + 2]
        for index in range(max(0, len(chinese) - 1))
        if not re.match(r"[a-z0-9_-]", chinese[index : index + 2])
    }
    return latin | grams


def retrieve_documents(
    db: Session,
    tenant_id: str,
    query: str,
    limit: int = 2,
) -> List[RetrievedDocument]:
    query_tokens = _tokens(query)
    docs = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.tenant_id == tenant_id)
        .all()
    )
    ranked: List[RetrievedDocument] = []
    for doc in docs:
        doc_tokens = _tokens(f"{doc.title} {doc.content}")
        overlap = len(query_tokens & doc_tokens)
        coverage = overlap / max(1, len(query_tokens))
        title_bonus = 0.12 if _tokens(doc.title) & query_tokens else 0.0
        score = min(0.99, 0.38 + coverage * 1.35 + title_bonus)
        if overlap:
            ranked.append(
                RetrievedDocument(
                    id=doc.id,
                    title=doc.title,
                    source=doc.source,
                    content=doc.content,
                    score=round(score, 2),
                )
            )
    ranked.sort(key=lambda item: item.score, reverse=True)
    if not ranked and docs:
        fallback = docs[0]
        ranked.append(
            RetrievedDocument(
                id=fallback.id,
                title=fallback.title,
                source=fallback.source,
                content=fallback.content,
                score=0.52,
            )
        )
    return ranked[:limit]

