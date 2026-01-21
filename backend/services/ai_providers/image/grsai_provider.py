"""
GRSAI Nano Banana Image Provider
Uses GRSAI's dedicated /v1/draw/nano-banana API endpoint
"""
import logging
import time
import requests
import base64
from io import BytesIO
from typing import Optional, List
from PIL import Image

from .base import ImageProvider
from config import get_config

logger = logging.getLogger(__name__)


class GRSAIImageProvider(ImageProvider):
    """GRSAI Nano Banana image generation using dedicated API"""
    
    # Aspect ratio mapping
    ASPECT_RATIO_MAP = {
        "16:9": "16:9",
        "9:16": "9:16",
        "4:3": "4:3",
        "3:4": "3:4",
        "1:1": "1:1",
        "3:2": "3:2",
        "2:3": "2:3",
        "21:9": "21:9",
        "auto": "auto"
    }
    
    # Resolution mapping to GRSAI imageSize
    RESOLUTION_MAP = {
        "1K": "1K",
        "2K": "2K",
        "4K": "4K"
    }
    
    # Model mapping
    MODEL_MAP = {
        "nano-banana-fast": "nano-banana-fast",
        "nano-banana": "nano-banana",
        "nano-banana-pro": "nano-banana-pro",
        "nano-banana-pro-vt": "nano-banana-pro-vt",
        "nano-banana-pro-cl": "nano-banana-pro-cl",
        "nano-banana-pro-vip": "nano-banana-pro-vip",
        "nano-banana-pro-4k-vip": "nano-banana-pro-4k-vip"
    }
    
    def __init__(self, api_key: str, api_base: str = "https://grsai.dakka.com.cn", model: str = "nano-banana-pro-cl"):
        """
        Initialize GRSAI provider
        
        Args:
            api_key: GRSAI API key
            api_base: Base URL for GRSAI API
            model: Model name (nano-banana-fast, nano-banana-pro-cl, etc.)
        """
        self.api_key = api_key
        self.api_base = api_base.rstrip('/')
        self.model = model if model in self.MODEL_MAP else "nano-banana-pro-cl"
        logger.info(f"GRSAI ImageProvider initialized - api_base={self.api_base}, model={self.model}")
    
    def _image_to_base64(self, image: Image.Image) -> str:
        """Convert PIL Image to base64 string (JPEG compress, no resize)"""
        buffered = BytesIO()
        # Convert to RGB to ensure JPEG compatibility
        if image.mode in ("RGBA", "LA"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[-1])
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        quality = get_config().REF_IMAGE_JPEG_QUALITY
        image.save(buffered, format="JPEG", quality=quality, optimize=True, progressive=True)
        img_bytes = buffered.getvalue()
        return base64.b64encode(img_bytes).decode('utf-8')
    
    def _download_image(self, url: str) -> Optional[Image.Image]:
        """Download image from URL"""
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return Image.open(BytesIO(response.content))
        except Exception as e:
            logger.error(f"Failed to download image from {url}: {e}")
            return None
    
    def generate_image(
        self,
        prompt: str,
        ref_images: Optional[List[Image.Image]] = None,
        aspect_ratio: str = "16:9",
        resolution: str = "2K",
        enable_thinking: bool = False,
        thinking_budget: int = 0
    ) -> Optional[Image.Image]:
        """
        Generate image using GRSAI API
        
        Args:
            prompt: Image generation prompt
            ref_images: Optional reference images
            aspect_ratio: Image aspect ratio
            resolution: Image resolution (1K, 2K, 4K)
            enable_thinking: Not used for GRSAI
            thinking_budget: Not used for GRSAI
            
        Returns:
            Generated PIL Image, or None if failed
        """
        try:
            # Build request
            grsai_aspect_ratio = self.ASPECT_RATIO_MAP.get(aspect_ratio, "auto")
            grsai_resolution = self.RESOLUTION_MAP.get(resolution, "2K")
            
            # Prepare request body
            request_body = {
                "model": self.model,
                "prompt": prompt,
                "aspectRatio": grsai_aspect_ratio,
                "imageSize": grsai_resolution,
                "shutProgress": True  # Only return final result
            }
            
            # Add reference images if provided
            if ref_images and len(ref_images) > 0:
                request_body["urls"] = []
                for img in ref_images:
                    base64_str = self._image_to_base64(img)
                    request_body["urls"].append(f"data:image/jpeg;base64,{base64_str}")
            
            logger.info(f"Calling GRSAI API - model={self.model}, aspectRatio={grsai_aspect_ratio}, imageSize={grsai_resolution}")
            
            # Use polling mode: set webHook to "-1" to get task ID immediately
            request_body["webHook"] = "-1"
            request_body["shutProgress"] = True
            
            logger.debug(f"Request body: {request_body}")
            
            # Call API to submit task
            url = f"{self.api_base}/v1/draw/nano-banana"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }
            
            response = requests.post(
                url,
                headers=headers,
                json=request_body,
                timeout=30  # Short timeout for submission
            )
            
            logger.info(f"GRSAI API submit response status: {response.status_code}")
            
            if response.status_code != 200:
                logger.error(f"GRSAI API error: {response.status_code} - {response.text}")
                return None
            
            # Parse submission response to get task ID
            submit_result = response.json()
            logger.debug(f"GRSAI API submit response: {submit_result}")
            
            if submit_result.get("code") != 0:
                logger.error(f"GRSAI API submission failed: {submit_result}")
                return None
            
            task_id = submit_result.get("data", {}).get("id")
            if not task_id:
                logger.error("No task ID in submission response")
                return None
            
            logger.info(f"Task submitted successfully, task_id: {task_id}, polling for result...")
            
            # Poll for result
            result_url = f"{self.api_base}/v1/draw/result"
            max_polls = 60  # Poll for up to 60 times (5 minutes total if 5s interval)
            poll_interval = 5  # Poll every 5 seconds
            
            for i in range(max_polls):
                time.sleep(poll_interval)
                
                try:
                    result_response = requests.post(
                        result_url,
                        headers=headers,
                        json={"id": task_id},
                        timeout=10
                    )
                    
                    if result_response.status_code != 200:
                        logger.warning(f"Poll {i+1}: Status {result_response.status_code}")
                        continue
                    
                    result = result_response.json()
                    
                    if result.get("code") == -22:
                        logger.warning(f"Poll {i+1}: Task not found yet")
                        continue
                    
                    if result.get("code") != 0:
                        logger.error(f"Poll {i+1}: Unexpected response: {result}")
                        continue
                    
                    data = result.get("data", {})
                    status = data.get("status")
                    progress = data.get("progress", 0)
                    
                    logger.info(f"Poll {i+1}: status={status}, progress={progress}%")
                    
                    if status == "succeeded":
                        results = data.get("results", [])
                        if results and len(results) > 0:
                            image_url = results[0].get("url")
                            if image_url:
                                logger.info(f"Image generated successfully, downloading from: {image_url}")
                                return self._download_image(image_url)
                        logger.error("No image URL in successful response")
                        return None
                    
                    elif status == "failed":
                        failure_reason = data.get("failure_reason", "")
                        error = data.get("error", "")
                        logger.error(f"GRSAI generation failed - reason={failure_reason}, error={error}")
                        return None
                    
                    # Status is "running", continue polling
                    
                except Exception as e:
                    logger.warning(f"Poll {i+1} exception: {type(e).__name__}: {str(e)}")
                    continue
            
            logger.error(f"Polling timed out after {max_polls * poll_interval} seconds")
            return None
                
        except Exception as e:
            logger.error(f"Error generating image with GRSAI: {type(e).__name__}: {str(e)}", exc_info=True)
            return None
