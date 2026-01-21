"""
Template Controller - handles template-related endpoints
"""
import logging
from flask import Blueprint, request, current_app
from models import db, Project, UserTemplate, Task
from utils import success_response, error_response, not_found, bad_request, allowed_file
from services import FileService
from services.ai_service_manager import get_ai_service
from services.task_manager import task_manager, generate_template_variants_task, generate_single_template_variant_task
from datetime import datetime
from werkzeug.utils import secure_filename
import tempfile
import shutil
from pathlib import Path
import json
import hashlib

logger = logging.getLogger(__name__)

template_bp = Blueprint('templates', __name__, url_prefix='/api/projects')
user_template_bp = Blueprint('user_templates', __name__, url_prefix='/api/user-templates')


def _append_template_variant_history(active_set: dict, variant_type: str, relative_path: str,
                                     max_history: int = 10) -> dict:
    if not isinstance(active_set, dict):
        active_set = {}
    history = active_set.get('template_variants_history')
    if not isinstance(history, dict):
        history = {}
    items = history.get(variant_type)
    if not isinstance(items, list):
        items = []
    items = [p for p in items if p and p != relative_path]
    items.insert(0, relative_path)
    if max_history and len(items) > max_history:
        items = items[:max_history]
    history[variant_type] = items
    active_set['template_variants_history'] = history
    return active_set


@template_bp.route('/<project_id>/template', methods=['POST'])
def upload_template(project_id):
    """
    POST /api/projects/{project_id}/template - Upload template image
    
    Content-Type: multipart/form-data
    Form: template_image=@file.png
    """
    try:
        project = Project.query.get(project_id)
        
        if not project:
            return not_found('Project')
        
        # Check if file is in request
        if 'template_image' not in request.files:
            return bad_request("No file uploaded")
        
        file = request.files['template_image']
        
        if file.filename == '':
            return bad_request("No file selected")
        
        # Validate file extension
        if not allowed_file(file.filename, current_app.config['ALLOWED_EXTENSIONS']):
            return bad_request("Invalid file type. Allowed types: png, jpg, jpeg, gif, webp")
        
        template_key = request.form.get('template_key', None)
        if not template_key:
            # Compute hash as template key for non-library uploads
            file_bytes = file.read()
            template_key = hashlib.sha256(file_bytes).hexdigest()
            file.stream.seek(0)

        # Save template (keyed filename)
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        file_path = file_service.save_template_image_with_key(file, project_id, template_key)
        
        # Update project
        project.template_image_path = file_path
        template_sets = project.get_template_sets()
        existing_set = template_sets.get(template_key, {})
        existing_variants = existing_set.get('template_variants') if isinstance(existing_set, dict) else {}
        if not isinstance(existing_variants, dict):
            existing_variants = {}
        existing_history = existing_set.get('template_variants_history') if isinstance(existing_set, dict) else {}
        if not isinstance(existing_history, dict):
            existing_history = {}

        template_sets[template_key] = {
            "template_image_path": file_path,
            "template_variants": existing_variants,
            "template_variants_history": existing_history
        }
        project.set_template_sets(template_sets)
        project.active_template_key = template_key
        # Sync current fields for compatibility
        project.set_template_variants(existing_variants)
        project.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response({
            'template_image_url': f'/files/{project_id}/template/{file_path.split("/")[-1]}',
            'template_key': template_key
        })
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/<project_id>/template', methods=['DELETE'])
def delete_template(project_id):
    """
    DELETE /api/projects/{project_id}/template - Delete template
    """
    try:
        project = Project.query.get(project_id)
        
        if not project:
            return not_found('Project')
        
        if not project.template_image_path:
            return bad_request("No template to delete")
        
        # Delete template file
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        file_service.delete_template(project_id)
        
        # Update project
        project.template_image_path = None
        project.set_template_variants(None)
        project.set_template_sets(None)
        project.active_template_key = None
        project.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(message="Template deleted successfully")
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/<project_id>/templates/generate', methods=['POST'])
def generate_template_variants(project_id):
    """
    POST /api/projects/{project_id}/templates/generate - Generate template variants

    Request body:
    {
        "types": ["cover", "transition", "ending"]
    }
    """
    try:
        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')

        data = request.get_json() or {}
        types = data.get('types') or ['cover', 'transition', 'ending']
        extra_requirements = (data.get('extra_requirements') or '').strip()
        allowed_types = {'cover', 'content', 'transition', 'ending'}
        types = [t for t in types if t in allowed_types]

        if not types:
            return bad_request("No valid template types provided")

        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        if not file_service.get_template_path(project_id):
            return bad_request("请先上传模板图片，再生成模板套装。")

        task = Task(
            project_id=project_id,
            task_type='GENERATE_TEMPLATE_VARIANTS',
            status='PENDING'
        )
        task.set_progress({
            "total": len(types),
            "completed": 0,
            "failed": 0
        })
        db.session.add(task)
        db.session.commit()

        ai_service = get_ai_service()
        app = current_app._get_current_object()

        task_manager.submit_task(
            task.id,
            generate_template_variants_task,
            project_id,
            types,
            ai_service,
            file_service,
            current_app.config['DEFAULT_ASPECT_RATIO'],
            current_app.config['DEFAULT_RESOLUTION'],
            app,
            extra_requirements if extra_requirements else None
        )

        return success_response({
            'task_id': task.id,
            'status': 'GENERATING_TEMPLATES',
            'total': len(types)
        }, status_code=202)

    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/<project_id>/templates/variant/<variant_type>/upload', methods=['POST'])
def upload_template_variant(project_id, variant_type):
    """
    POST /api/projects/{project_id}/templates/variant/{variant_type}/upload
    Upload and replace a single template variant image.

    Content-Type: multipart/form-data
    Form: variant_image=@file.png
    """
    try:
        allowed_types = {'cover', 'content', 'transition', 'ending'}
        if variant_type not in allowed_types:
            return bad_request(f"Invalid variant type: {variant_type}")

        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')

        if 'variant_image' not in request.files:
            return bad_request("No file uploaded")

        file = request.files['variant_image']
        if file.filename == '':
            return bad_request("No file selected")

        if not allowed_file(file.filename, current_app.config['ALLOWED_EXTENSIONS']):
            return bad_request("Invalid file type. Allowed types: png, jpg, jpeg, gif, webp")

        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        template_key = project.active_template_key or 'legacy'
        file_path = file_service.save_template_variant_upload(
            file, project_id, variant_type, template_key=template_key, with_timestamp=True
        )

        template_sets = project.get_template_sets()
        active_set = template_sets.get(template_key) or {}
        active_variants = active_set.get('template_variants') if isinstance(active_set, dict) else {}
        if not isinstance(active_variants, dict):
            active_variants = {}
        active_variants[variant_type] = file_path
        active_set = {
            "template_image_path": project.template_image_path,
            "template_variants": active_variants,
            "template_variants_history": (active_set.get('template_variants_history')
                                          if isinstance(active_set, dict) else {}) or {}
        }
        active_set = _append_template_variant_history(active_set, variant_type, file_path)
        template_sets[template_key] = active_set
        project.set_template_sets(template_sets)
        project.active_template_key = template_key
        project.set_template_variants(active_variants)
        project.updated_at = datetime.utcnow()
        db.session.commit()

        return success_response({
            'variant_type': variant_type,
            'template_variant_url': f'/files/{project_id}/template/{Path(file_path).name}'
        })
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/<project_id>/templates/variant/<variant_type>/regenerate', methods=['POST'])
def regenerate_template_variant(project_id, variant_type):
    """
    POST /api/projects/{project_id}/templates/variant/{variant_type}/regenerate
    Regenerate a single template variant with optional extra requirements and reference images.
    """
    try:
        allowed_types = {'cover', 'content', 'transition', 'ending'}
        if variant_type not in allowed_types:
            return bad_request(f"Invalid variant type: {variant_type}")

        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')

        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        if not file_service.get_template_path(project_id):
            return bad_request("请先上传模板图片，再生成模板套装。")

        temp_dir = None
        uploaded_files = []
        if request.is_json:
            data = request.get_json() or {}
        else:
            data = request.form.to_dict()
            uploaded_files = request.files.getlist('context_images')
            if 'ref_image_urls' in data and data['ref_image_urls']:
                try:
                    data['ref_image_urls'] = json.loads(data['ref_image_urls'])
                except Exception:
                    data['ref_image_urls'] = []

        extra_requirements = (data.get('extra_requirements') or '').strip()
        ref_image_urls = data.get('ref_image_urls') or []
        if isinstance(ref_image_urls, str):
            try:
                ref_image_urls = json.loads(ref_image_urls)
            except Exception:
                ref_image_urls = []
        if not isinstance(ref_image_urls, list):
            ref_image_urls = []

        user_ref_images = []
        if ref_image_urls:
            user_ref_images.extend([str(u) for u in ref_image_urls if u])

        if uploaded_files:
            temp_dir = Path(tempfile.mkdtemp(dir=current_app.config['UPLOAD_FOLDER']))
            try:
                for uploaded_file in uploaded_files:
                    if uploaded_file.filename:
                        temp_path = temp_dir / secure_filename(uploaded_file.filename)
                        uploaded_file.save(str(temp_path))
                        user_ref_images.append(str(temp_path))
            except Exception as e:
                if temp_dir and temp_dir.exists():
                    shutil.rmtree(temp_dir)
                raise e

        task = Task(
            project_id=project_id,
            task_type='GENERATE_TEMPLATE_VARIANT',
            status='PENDING'
        )
        task.set_progress({
            "total": 1,
            "completed": 0,
            "failed": 0
        })
        db.session.add(task)
        db.session.commit()

        ai_service = get_ai_service()
        app = current_app._get_current_object()

        task_manager.submit_task(
            task.id,
            generate_single_template_variant_task,
            project_id,
            variant_type,
            ai_service,
            file_service,
            current_app.config['DEFAULT_ASPECT_RATIO'],
            current_app.config['DEFAULT_RESOLUTION'],
            app,
            extra_requirements if extra_requirements else None,
            user_ref_images if user_ref_images else None,
            str(temp_dir) if temp_dir else None
        )

        return success_response({
            'task_id': task.id,
            'status': 'GENERATING_TEMPLATE_VARIANT',
            'variant_type': variant_type
        }, status_code=202)

    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/<project_id>/templates/variant/<variant_type>/select', methods=['POST'])
def select_template_variant(project_id, variant_type):
    """
    POST /api/projects/{project_id}/templates/variant/{variant_type}/select
    Select a historical variant image as current.
    """
    try:
        allowed_types = {'cover', 'content', 'transition', 'ending'}
        if variant_type not in allowed_types:
            return bad_request(f"Invalid variant type: {variant_type}")

        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')

        data = request.get_json() or {}
        variant_value = (data.get('variant_url') or data.get('variant_path') or '').strip()
        if not variant_value:
            return bad_request("variant_url is required")

        # Convert URL to relative path
        if variant_value.startswith('/files/'):
            filename = Path(variant_value).name
            relative_path = f"{project_id}/template/{filename}"
        else:
            relative_path = variant_value

        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        abs_path = Path(file_service.get_absolute_path(relative_path))
        if not abs_path.exists():
            return bad_request("Variant file not found")

        template_sets = project.get_template_sets()
        template_key = project.active_template_key or 'legacy'
        active_set = template_sets.get(template_key) or {}
        active_variants = active_set.get('template_variants') if isinstance(active_set, dict) else {}
        if not isinstance(active_variants, dict):
            active_variants = {}
        history = active_set.get('template_variants_history') if isinstance(active_set, dict) else {}
        if not isinstance(history, dict):
            history = {}

        # Ensure selection exists in history (match by filename if needed)
        candidate_list = history.get(variant_type) if isinstance(history.get(variant_type), list) else []
        if relative_path not in candidate_list:
            filename = Path(relative_path).name
            matched = next((p for p in candidate_list if Path(p).name == filename), None)
            if matched:
                relative_path = matched
            else:
                return bad_request("Selected variant is not in history")

        active_variants[variant_type] = relative_path
        active_set = {
            "template_image_path": project.template_image_path,
            "template_variants": active_variants,
            "template_variants_history": history
        }
        active_set = _append_template_variant_history(active_set, variant_type, relative_path)
        template_sets[template_key] = active_set
        project.set_template_sets(template_sets)
        project.active_template_key = template_key
        project.set_template_variants(active_variants)
        project.updated_at = datetime.utcnow()
        db.session.commit()

        return success_response({
            'variant_type': variant_type,
            'template_variant_url': f'/files/{project_id}/template/{Path(relative_path).name}'
        })
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@template_bp.route('/templates', methods=['GET'])
def get_system_templates():
    """
    GET /api/templates - Get system preset templates
    
    Note: This is a placeholder for future implementation
    """
    # TODO: Implement system templates
    templates = []
    
    return success_response({
        'templates': templates
    })


# ========== User Template Endpoints ==========

@user_template_bp.route('', methods=['POST'])
def upload_user_template():
    """
    POST /api/user-templates - Upload user template image

    Content-Type: multipart/form-data
    Form: template_image=@file.png
    Optional: name=Template Name
    """
    try:
        # Check if file is in request
        if 'template_image' not in request.files:
            return bad_request("No file uploaded")

        file = request.files['template_image']

        if file.filename == '':
            return bad_request("No file selected")

        # Validate file extension
        if not allowed_file(file.filename, current_app.config['ALLOWED_EXTENSIONS']):
            return bad_request("Invalid file type. Allowed types: png, jpg, jpeg, gif, webp")

        # Get optional name
        name = request.form.get('name', None)

        # Get file size before saving
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning

        # Generate template ID first
        import uuid
        template_id = str(uuid.uuid4())

        # Save template file first (using the generated ID)
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        file_path = file_service.save_user_template(file, template_id)

        # Generate thumbnail for faster loading
        thumb_path = file_service.save_user_template_thumbnail(template_id, file_path)

        # Create template record with file_path already set
        template = UserTemplate(
            id=template_id,
            name=name,
            file_path=file_path,
            thumb_path=thumb_path,
            file_size=file_size
        )
        db.session.add(template)
        db.session.commit()

        return success_response(template.to_dict())
    
    except Exception as e:
        import traceback
        db.session.rollback()
        error_msg = str(e)
        logger.error(f"Error uploading user template: {error_msg}", exc_info=True)
        # 在开发环境中返回详细错误，生产环境返回通用错误
        if current_app.config.get('DEBUG', False):
            return error_response('SERVER_ERROR', f"{error_msg}\n{traceback.format_exc()}", 500)
        else:
            return error_response('SERVER_ERROR', error_msg, 500)


@user_template_bp.route('', methods=['GET'])
def list_user_templates():
    """
    GET /api/user-templates - Get list of user templates
    """
    try:
        templates = UserTemplate.query.order_by(UserTemplate.created_at.desc()).all()
        
        return success_response({
            'templates': [template.to_dict() for template in templates]
        })
    
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)


@user_template_bp.route('/<template_id>', methods=['DELETE'])
def delete_user_template(template_id):
    """
    DELETE /api/user-templates/{template_id} - Delete user template
    """
    try:
        template = UserTemplate.query.get(template_id)
        
        if not template:
            return not_found('UserTemplate')
        
        # Delete template file
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        file_service.delete_user_template(template_id)
        
        # Delete template record
        db.session.delete(template)
        db.session.commit()
        
        return success_response(message="Template deleted successfully")
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)

