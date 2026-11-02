<?php
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
if (preg_match('~^/(?:database|tests|storage|tools|\.runtime)(?:/|$)|(?:^|/)\.|^/(?:cookies|scratch_cookie)\.txt$~i', $path)) { http_response_code(404); exit; }
return false;
