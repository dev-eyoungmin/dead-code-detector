<?php

namespace App\Services;

class Mailer
{
    public function send()
    {
        $this->format();
    }

    private function format()
    {
    }

    private function deadPrivate()
    {
    }

    public function __toString()
    {
        return 'Mailer';
    }
}
