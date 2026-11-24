"""short product name for the sidebar

Revision ID: 0010
Revises: 0009
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("business_projects", sa.Column("short_name", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("business_projects", "short_name")
