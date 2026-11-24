"""shared SerpApi response cache

Revision ID: 0011
Revises: 0010
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "serp_cache",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("engine", sa.String(length=40), nullable=False),
        sa.Column("response", postgresql.JSONB(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_serp_cache_fetched_at", "serp_cache", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_serp_cache_fetched_at", table_name="serp_cache")
    op.drop_table("serp_cache")
