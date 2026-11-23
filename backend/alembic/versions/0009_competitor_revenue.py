"""competitor revenue (only when a source states it)

Revision ID: 0009
Revises: 0008
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("competitors", sa.Column("revenue", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("competitors", "revenue")
