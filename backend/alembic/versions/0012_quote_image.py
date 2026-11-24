"""listing photo on supplier quotes

Revision ID: 0012
Revises: 0011
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("supplier_quotes", sa.Column("image_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("supplier_quotes", "image_url")
