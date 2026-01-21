"""Add reading_deck to projects

Revision ID: 015_add_reading_deck_to_projects
Revises: 014_add_material_display_name_note
Create Date: 2026-01-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = '015_add_reading_deck_to_projects'
down_revision = '014_add_material_display_name_note'
branch_labels = None
depends_on = None


def upgrade():
    # Idempotent migration: in some environments the column may already exist
    # (e.g., manual schema changes or partially applied migrations).
    bind = op.get_bind()
    cols = []
    try:
        rows = bind.execute(text("PRAGMA table_info(projects)")).fetchall()
        # PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
        cols = [r[1] for r in rows]
    except Exception:
        cols = []

    if 'reading_deck' not in cols:
        op.add_column(
            'projects',
            sa.Column('reading_deck', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column('projects', 'reading_deck', server_default=None)


def downgrade():
    # Best-effort: SQLite may not support dropping columns in older versions.
    try:
        op.drop_column('projects', 'reading_deck')
    except Exception:
        pass
