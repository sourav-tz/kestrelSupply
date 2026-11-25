import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List


@dataclass
class PolicyChunk:
    section_id: str
    title: str
    category_tags: List[str]
    content: str


class LocalPolicyRAG:
    """
    Deterministic TF-IDF + section-tag RAG retriever over the local markdown policy document.
    Inspectable, zero external dependencies, and returns exact cited sections.
    """

    def __init__(self, policy_path: Path | None = None) -> None:
        self.policy_path = policy_path or (Path(__file__).resolve().parent / "return_policy.md")
        self.chunks: List[PolicyChunk] = self._load_chunks()
        self.idf: Dict[str, float] = self._compute_idf()

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return re.findall(r"[a-z0-9]+", text.lower())

    def _load_chunks(self) -> List[PolicyChunk]:
        raw = self.policy_path.read_text(encoding="utf-8")
        sections = re.split(r"\n##\s+", raw)
        chunks: List[PolicyChunk] = []
        for idx, block in enumerate(sections):
            lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
            if not lines:
                continue
            if idx == 0 and lines[0].startswith("# "):
                continue
            title = lines[0].lstrip("# ").strip()
            body_lines = lines[1:]
            # Split bullet points inside Category Return Windows for granular retrieval
            if "category return windows" in title.lower():
                for b_idx, line in enumerate(body_lines):
                    clean = line.lstrip("- ").strip()
                    tag_match = re.match(r"\*\*([^*]+)\*\*", clean)
                    tags = [tag_match.group(1).lower()] if tag_match else ["general"]
                    chunks.append(
                        PolicyChunk(
                            section_id=f"sec-{idx}-{b_idx}",
                            title=f"{title}: {tag_match.group(1) if tag_match else 'Rule'}",
                            category_tags=tags,
                            content=clean.replace("**", ""),
                        )
                    )
            else:
                chunks.append(
                    PolicyChunk(
                        section_id=f"sec-{idx}",
                        title=title,
                        category_tags=["general", "escalation", "threshold", "security"],
                        content=" ".join(ln.lstrip("- ").replace("**", "") for ln in body_lines),
                    )
                )
        return chunks

    def _compute_idf(self) -> Dict[str, float]:
        doc_count = max(len(self.chunks), 1)
        df: Counter[str] = Counter()
        for chunk in self.chunks:
            tokens = set(self._tokenize(f"{chunk.title} {chunk.content}"))
            for token in tokens:
                df[token] += 1
        return {
            token: math.log((doc_count + 1) / (freq + 1)) + 1.0
            for token, freq in df.items()
        }

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, object]]:
        q_tokens = self._tokenize(query)
        if not q_tokens:
            return []
        q_counts = Counter(q_tokens)
        scored = []
        for chunk in self.chunks:
            c_tokens = self._tokenize(f"{chunk.title} {' '.join(chunk.category_tags)} {chunk.content}")
            c_counts = Counter(c_tokens)
            score = 0.0
            for token, q_freq in q_counts.items():
                if token in c_counts:
                    score += (1 + math.log(q_freq)) * (1 + math.log(c_counts[token])) * self.idf.get(token, 1.0)
            # Boost exact category tag matches
            for tag in chunk.category_tags:
                if any(tok in tag for tok in q_tokens):
                    score += 3.5
            if score > 0:
                scored.append((score, chunk))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {
                "section_id": chunk.section_id,
                "title": chunk.title,
                "score": round(score, 3),
                "content": chunk.content,
            }
            for score, chunk in scored[:top_k]
        ]

    def full_document(self) -> str:
        return self.policy_path.read_text(encoding="utf-8")


policy_rag = LocalPolicyRAG()
