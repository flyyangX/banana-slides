"""
Project model
"""
import uuid
import json
from pathlib import Path
from datetime import datetime
from . import db


class Project(db.Model):
    """
    Project model - represents a PPT project
    """
    __tablename__ = 'projects'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    idea_prompt = db.Column(db.Text, nullable=True)
    outline_text = db.Column(db.Text, nullable=True)  # 用户输入的大纲文本（用于outline类型）
    description_text = db.Column(db.Text, nullable=True)  # 用户输入的描述文本（用于description类型）
    extra_requirements = db.Column(db.Text, nullable=True)  # 额外要求，应用到每个页面的AI提示词
    creation_type = db.Column(db.String(20), nullable=False, default='idea')  # idea|outline|descriptions
    template_image_path = db.Column(db.String(500), nullable=True)
    template_variants = db.Column(db.Text, nullable=True)  # JSON string: {"content": "...", "cover": "...", ...}
    template_sets = db.Column(db.Text, nullable=True)  # JSON string: {templateKey: {template_image_path, template_variants}}
    active_template_key = db.Column(db.String(120), nullable=True)
    template_style = db.Column(db.Text, nullable=True)  # 风格描述文本（无模板图模式）
    # 导出设置
    export_extractor_method = db.Column(db.String(50), nullable=True, default='hybrid')  # 组件提取方法: mineru, hybrid
    export_inpaint_method = db.Column(db.String(50), nullable=True, default='hybrid')  # 背景图获取方法: generative, baidu, hybrid
    status = db.Column(db.String(50), nullable=False, default='DRAFT')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    # 使用 'select' 策略支持 eager loading，同时保持灵活性
    pages = db.relationship('Page', back_populates='project', lazy='select', 
                           cascade='all, delete-orphan', order_by='Page.order_index')
    tasks = db.relationship('Task', back_populates='project', lazy='select',
                           cascade='all, delete-orphan')
    materials = db.relationship('Material', back_populates='project', lazy='select',
                           cascade='all, delete-orphan')
    
    def to_dict(self, include_pages=False):
        """Convert to dictionary"""
        # Format created_at and updated_at with UTC timezone indicator for proper frontend parsing
        created_at_str = None
        if self.created_at:
            created_at_str = self.created_at.isoformat() + 'Z' if not self.created_at.tzinfo else self.created_at.isoformat()
        
        updated_at_str = None
        if self.updated_at:
            updated_at_str = self.updated_at.isoformat() + 'Z' if not self.updated_at.tzinfo else self.updated_at.isoformat()
        
        template_variants = self.get_template_variants()
        template_variants_urls = {}
        for key, rel_path in template_variants.items():
            if rel_path:
                filename = Path(rel_path).name
                template_variants_urls[key] = f'/files/{self.id}/template/{filename}'

        if 'content' not in template_variants_urls and self.template_image_path:
            filename = Path(self.template_image_path).name
            template_variants_urls['content'] = f'/files/{self.id}/template/{filename}'

        # Template variants history (active template set)
        template_variants_history_urls = {}
        template_sets = self.get_template_sets()
        active_key = self.active_template_key
        active_set = template_sets.get(active_key, {}) if active_key else {}
        raw_history = active_set.get('template_variants_history') if isinstance(active_set, dict) else {}
        if not isinstance(raw_history, dict):
            raw_history = {}
        for key, paths in raw_history.items():
            if isinstance(paths, list):
                urls = []
                for rel_path in paths:
                    if rel_path:
                        filename = Path(rel_path).name
                        urls.append(f'/files/{self.id}/template/{filename}')
                if urls:
                    template_variants_history_urls[key] = urls
        # 兼容：若没有历史，至少放入当前版本
        if not template_variants_history_urls:
            for key, rel_path in template_variants.items():
                if rel_path:
                    filename = Path(rel_path).name
                    template_variants_history_urls[key] = [f'/files/{self.id}/template/{filename}']

        data = {
            'project_id': self.id,
            'idea_prompt': self.idea_prompt,
            'outline_text': self.outline_text,
            'description_text': self.description_text,
            'extra_requirements': self.extra_requirements,
            'creation_type': self.creation_type,
            'template_image_url': f'/files/{self.id}/template/{self.template_image_path.split("/")[-1]}' if self.template_image_path else None,
            'template_variants': template_variants_urls,
            'active_template_key': self.active_template_key,
            'template_style': self.template_style,
            'template_variants_history': template_variants_history_urls,
            'export_extractor_method': self.export_extractor_method or 'hybrid',
            'export_inpaint_method': self.export_inpaint_method or 'hybrid',
            'status': self.status,
            'created_at': created_at_str,
            'updated_at': updated_at_str,
        }
        
        if include_pages:
            # pages 现在是列表，不需要 order_by（已在 relationship 中定义）
            data['pages'] = [page.to_dict() for page in self.pages]
        
        return data
    
    def __repr__(self):
        return f'<Project {self.id}: {self.status}>'

    def get_template_variants(self):
        """Parse template_variants from JSON string"""
        if self.template_variants:
            try:
                data = json.loads(self.template_variants)
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}

    def set_template_variants(self, data):
        """Set template_variants as JSON string"""
        if data:
            self.template_variants = json.dumps(data, ensure_ascii=False)
        else:
            self.template_variants = None

    def get_template_sets(self):
        """Parse template_sets from JSON string"""
        if self.template_sets:
            try:
                data = json.loads(self.template_sets)
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}

    def set_template_sets(self, data):
        """Set template_sets as JSON string"""
        if data:
            self.template_sets = json.dumps(data, ensure_ascii=False)
        else:
            self.template_sets = None

