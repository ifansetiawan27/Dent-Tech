Add-Type -AssemblyName System.Drawing

function Resize-Jpeg($srcPath, $dstPath, $targetWidth, $quality) {
  $img = [System.Drawing.Image]::FromFile($srcPath)
  $ratio = $targetWidth / $img.Width
  $targetHeight = [int]($img.Height * $ratio)
  $bmp = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $targetWidth, $targetHeight)
  $g.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
  $bmp.Save($dstPath, $codec, $ep)
  $bmp.Dispose()
  $img.Dispose()
  $kb = [math]::Round((Get-Item $dstPath).Length / 1KB, 1)
  Write-Output "$dstPath -> ${targetWidth}x${targetHeight}, $kb KB"
}

$src = "$PWD\Logo\background_Landing_pages.jpeg"
Resize-Jpeg $src "$PWD\frontend\assets\bg-landing.jpg" 1600 72
Resize-Jpeg $src "$PWD\frontend\assets\bg-landing-sm.jpg" 828 70
