$d = "c:\Projects\villa-pms\design\stitch\a6-my-villas"
New-Item -ItemType Directory -Path $d -Force | Out-Null
Invoke-WebRequest -Uri "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1M2Y0ZGRjZmMwOWUwMzMyZWRlMGZjMjg2NTNjEgsSBxCTn6GK7RQYAZIBJAoKcHJvamVjdF9pZBIWQhQxNDgzNzg1MDI4NzE2MDc3MzY3Mw&filename=&opi=89354086" -OutFile (Join-Path $d "index.html") -UseBasicParsing
Invoke-WebRequest -Uri "https://lh3.googleusercontent.com/aida/AP1WRLu54ZwnamK_wihiFxjM5LpE1aSafiiS_RJIoL0GFIaxGH-KZ6CQseux3gdIv2umIg5BkGllSEm5FOaeHLbIKoJuntxVL8wPym1zBAMFRGH5gPVQFELL8VOHvU9zbfKyqD6T6F194JbEGe-51uJu4RehK9DOI38fE3-46GDfetpQsb9_KpVw9YeLVq4xV04ipIIDXUqnLHWoXP8PK22zcMKj7TVE6NF0rTHCsieRvlFJLkPFDwQhfbAEyws" -OutFile (Join-Path $d "screenshot.png") -UseBasicParsing
Write-Host "OK a6-my-villas"
