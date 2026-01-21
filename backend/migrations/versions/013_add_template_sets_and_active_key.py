"""Add template_sets and active_template_key to projects

Revision ID: 013_add_template_sets_and_active_key
Revises: 012_add_page_type_and_template_variants
Create Date: 2026-01-22
"""
import json
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '013_add_template_sets_and_active_key'
down_revision = '012_add_page_type_and_template_variants'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('template_sets', sa.Text(), nullable=True))
    op.add_column('projects', sa.Column('active_template_key', sa.String(length=120), nullable=True))

    # Backfill existing rows with a legacy template set (if any)
    bind = op.get_bind()
    projects = sa.table(
        'projects',
        sa.column('id', sa.String(length=36)),
        sa.column('template_image_path', sa.String(length=500)),
        sa.column('template_variants', sa.Text()),
        sa.column('template_sets', sa.Text()),
        sa.column('active_template_key', sa.String(length=120)),
    )

    rows = bind.execute(
        sa.select(
            projects.c.id,
            projects.c.template_image_path,
            projects.c.template_variants,
            projects.c.template_sets,
            projects.c.active_template_key,
        )
    ).fetchall()

    for row in rows:
        if row.template_sets:
            continue

        template_variants = {}
        if row.template_variants:
            try:
                parsed = json.loads(row.template_variants)
                if isinstance(parsed, dict):
                    template_variants = parsed
            except Exception:
                template_variants = {}

        has_any_template = bool(row.template_image_path) or bool(template_variants)
        if not has_any_template:
            continue

        legacy_key = 'legacy'
        template_sets = {
            legacy_key: {
                "template_image_path": row.template_image_path,
                "template_variants": template_variants,
            }
        }

        bind.execute(
            projects.update()
            .where(projects.c.id == row.id)
            .values(
                template_sets=json.dumps(template_sets, ensure_ascii=False),
                active_template_key=legacy_key
            )
        )


def downgrade():
    op.drop_column('projects', 'active_template_key')
    op.drop_column('projects', 'template_sets')
